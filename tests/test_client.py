"""Tests for the HTTP core: retries, pagination, caching, errors, GraphQL."""

from __future__ import annotations

import httpx
import pytest

from tests.conftest import MockAPI
from twopro.client import GitHubClient, Page, guess_repo_path
from twopro.errors import (
    AuthenticationError,
    NotFoundError,
    RateLimitError,
    ServerError,
    TransportError,
    error_for_status,
)
from twopro.models import RateLimit


def client_for(api: MockAPI, **kwargs) -> GitHubClient:
    return GitHubClient("tok", transport=api.transport, sleep=lambda *_: None, **kwargs)


# --------------------------------------------------------------------- basics


def test_get_returns_decoded_json(api: MockAPI) -> None:
    api.get("/repos/a/b", json={"name": "b", "id": 1})
    with client_for(api) as client:
        assert client.get("/repos/a/b")["name"] == "b"


def test_authorization_header_and_user_agent(api: MockAPI) -> None:
    api.get("/user", json={"login": "x"})
    with client_for(api) as client:
        client.get("/user")
    request = api.calls[0]
    assert request.headers["authorization"] == "Bearer tok"
    assert request.headers["x-github-api-version"] == "2022-11-28"
    assert "2pro/" in request.headers["user-agent"]


def test_anonymous_client_omits_auth_header(api: MockAPI) -> None:
    api.get("/user", json={})
    client = GitHubClient(None, transport=api.transport, settings=_settings_no_token())
    client.get("/user")
    assert "authorization" not in api.calls[0].headers


def _settings_no_token():
    from twopro.config import Settings

    return Settings(token=None)


def test_delete_returns_none_for_empty_body(api: MockAPI) -> None:
    api.route("DELETE", "/repos/a/b", status=204)
    with client_for(api) as client:
        assert client.delete("/repos/a/b") is None


def test_params_are_cleaned_and_joined(api: MockAPI) -> None:
    api.get("/repos/a/b/issues", json=[])
    with client_for(api) as client:
        client.get(
            "/repos/a/b/issues", params={"labels": ["bug", "ui"], "state": None, "draft": True}
        )
    query = api.calls[0].url.query.decode()
    assert "labels=bug%2Cui" in query
    assert "state" not in query
    assert "draft=true" in query


def test_per_page_default_is_applied(api: MockAPI) -> None:
    api.get("/user/repos", json=[])
    with client_for(api) as client:
        list(client.paginate("/user/repos"))
    assert "per_page=100" in api.calls[0].url.query.decode()


# --------------------------------------------------------------------- errors


def test_404_raises_not_found(api: MockAPI) -> None:
    api.get("/repos/a/missing", status=404, json={"message": "Not Found"})
    with client_for(api) as client, pytest.raises(NotFoundError) as exc:
        client.get("/repos/a/missing")
    assert exc.value.status_code == 404
    assert "Not Found" in str(exc.value)


def test_401_raises_authentication_error(api: MockAPI) -> None:
    api.get("/user", status=401, json={"message": "Bad credentials"})
    with client_for(api) as client, pytest.raises(AuthenticationError):
        client.get("/user")


def test_422_includes_field_errors(api: MockAPI) -> None:
    api.post(
        "/repos/a/b/issues",
        status=422,
        json={
            "message": "Validation Failed",
            "errors": [{"resource": "Issue", "field": "title", "code": "missing_field"}],
        },
    )
    with client_for(api) as client, pytest.raises(Exception) as exc:
        client.post("/repos/a/b/issues", json={})
    assert "missing_field" in str(exc.value)


def test_primary_rate_limit_becomes_rate_limit_error(api: MockAPI) -> None:
    api.get(
        "/user",
        status=403,
        json={"message": "API rate limit exceeded for user ID 1."},
        headers={"x-ratelimit-remaining": "0", "x-ratelimit-reset": "4102444800"},
    )
    with client_for(api) as client, pytest.raises(RateLimitError) as exc:
        client.get("/user")
    assert exc.value.wait_seconds is not None


def test_secondary_rate_limit_is_retried_then_raised(api: MockAPI) -> None:
    api.get(
        "/user",
        status=403,
        json={"message": "You have exceeded a secondary rate limit. Please wait a few minutes."},
        headers={"retry-after": "1"},
    )
    with client_for(api, max_retries=1) as client, pytest.raises(RateLimitError):
        client.get("/user")
    # retried once (2 calls total) because Retry-After was present
    assert len(api.calls) == 2


def test_transport_errors_are_wrapped(api: MockAPI) -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("nope", request=request)

    client = GitHubClient(
        "tok", transport=httpx.MockTransport(boom), sleep=lambda *_: None, max_retries=0
    )
    with pytest.raises(TransportError):
        client.get("/user")


def test_error_for_status_mapping() -> None:
    assert error_for_status(404) is NotFoundError
    assert error_for_status(500).__name__ == "ServerError"
    assert error_for_status(418).__name__ == "GitHubError"


# -------------------------------------------------------------------- retries


def test_retries_on_server_error_then_succeeds(api: MockAPI) -> None:
    # The mock replays the same response, so use a stateful handler instead.
    state = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        state["count"] += 1
        if state["count"] < 3:
            return httpx.Response(503, json={"message": "unavailable"})
        return httpx.Response(200, json={"login": "elazamey"})

    client = GitHubClient(
        "tok", transport=httpx.MockTransport(handler), sleep=lambda *_: None, max_retries=3
    )
    assert client.get("/user")["login"] == "elazamey"
    assert state["count"] == 3


def test_gives_up_after_max_retries(api: MockAPI) -> None:
    state = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        state["count"] += 1
        return httpx.Response(500, json={"message": "boom"})

    client = GitHubClient(
        "tok", transport=httpx.MockTransport(handler), sleep=lambda *_: None, max_retries=2
    )
    with pytest.raises(ServerError):
        client.get("/user")
    assert state["count"] == 3


def test_no_retry_on_client_errors(api: MockAPI) -> None:
    api.get("/user", status=404, json={"message": "Not Found"})
    with client_for(api, max_retries=3) as client, pytest.raises(NotFoundError):
        client.get("/user")
    assert len(api.calls) == 1


# ----------------------------------------------------------------- pagination


def test_pagination_follows_link_header(api: MockAPI) -> None:
    api.get(
        "/user/repos?per_page=1",
        json=[{"id": 1, "name": "one", "owner": {"login": "a"}}],
        headers={"link": '<https://api.github.com/user/repos?page=2>; rel="next"'},
    )
    api.get("/user/repos?page=2", json=[{"id": 2, "name": "two", "owner": {"login": "a"}}])
    with client_for(api) as client:
        names = [r["name"] for r in client.paginate("/user/repos", per_page=1)]
    assert names == ["one", "two"]


def test_pagination_honours_max_items(api: MockAPI) -> None:
    api.get(
        "/user/repos", json=[{"id": i, "name": f"r{i}", "owner": {"login": "a"}} for i in range(5)]
    )
    with client_for(api) as client:
        items = list(client.paginate("/user/repos", max_items=2, per_page=5))
    assert len(items) == 2


def test_pagination_extracts_nested_item_keys(api: MockAPI) -> None:
    api.get(
        "/repos/a/b/actions/runs",
        json={"total_count": 1, "workflow_runs": [{"id": 7, "name": "CI"}]},
    )
    with client_for(api) as client:
        runs = list(client.paginate("/repos/a/b/actions/runs"))
    assert runs[0]["id"] == 7


def test_iter_pages_returns_metadata(api: MockAPI) -> None:
    api.get(
        "/user/repos",
        json=[{"id": 1, "name": "x", "owner": {"login": "a"}}],
        headers={"etag": 'W/"abc"'},
    )
    with client_for(api) as client:
        page = next(client.iter_pages("/user/repos"))
    assert isinstance(page, Page)
    assert page.etag == 'W/"abc"'
    assert len(page) == 1


def test_get_all_collects_every_page(api: MockAPI) -> None:
    api.get("/user/repos", json=[{"id": 1, "name": "x", "owner": {"login": "a"}}])
    with client_for(api) as client:
        assert len(client.get_all("/user/repos", per_page=100)) == 1


def test_max_pages_stops_early(api: MockAPI) -> None:
    api.get(
        "/user/repos?per_page=1",
        json=[{"id": 1, "name": "one", "owner": {"login": "a"}}],
        headers={"link": '<https://api.github.com/user/repos?page=2>; rel="next"'},
    )
    api.get("/user/repos?page=2", json=[{"id": 2, "name": "two", "owner": {"login": "a"}}])
    with client_for(api) as client:
        items = list(client.paginate("/user/repos", per_page=1, max_pages=1))
    assert len(items) == 1


# ------------------------------------------------------------------- caching


def test_etag_cache_serves_304_from_memory(api: MockAPI) -> None:
    first = api.get("/repos/a/b", json={"id": 1, "name": "b"}, headers={"etag": 'W/"v1"'})
    assert first is not None
    with client_for(api) as client:
        client.get("/repos/a/b", use_cache=True)
        # second call: the mock returns 304, the client must answer from cache
        api.route("GET", "/repos/a/b", status=304)
        assert client.get("/repos/a/b", use_cache=True)["name"] == "b"
    assert client.last_response.headers.get("x-2pro-cache") == "hit"


def test_clear_cache_forgets_etags(api: MockAPI) -> None:
    api.get("/repos/a/b", json={"id": 1, "name": "b"}, headers={"etag": 'W/"v1"'})
    with client_for(api) as client:
        client.get("/repos/a/b", use_cache=True)
        client.clear_cache()
        assert client._etag_cache == {}


# ------------------------------------------------------------- rate limiting


def test_rate_limit_headers_are_tracked(api: MockAPI) -> None:
    api.get(
        "/user",
        json={"login": "a"},
        headers={
            "x-ratelimit-limit": "5000",
            "x-ratelimit-remaining": "4999",
            "x-ratelimit-used": "1",
            "x-ratelimit-reset": "4102444800",
            "x-ratelimit-resource": "core",
        },
    )
    with client_for(api) as client:
        client.get("/user")
        assert isinstance(client.rate_limit, RateLimit)
        assert client.rate_limit.remaining == 4999
        assert client.rate_limit.used_ratio == pytest.approx(1 / 5000)


def test_rate_limit_status_fetches_core(api: MockAPI) -> None:
    api.get(
        "/rate_limit",
        json={
            "resources": {
                "core": {"limit": 5000, "used": 10, "remaining": 4990, "reset": 4102444800}
            }
        },
    )
    with client_for(api) as client:
        core = client.rate_limit_status(refresh=True)
    assert core.limit == 5000 and core.remaining == 4990


def test_assert_budget_raises_when_exhausted(api: MockAPI) -> None:
    api.get(
        "/user",
        json={},
        headers={
            "x-ratelimit-limit": "10",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-used": "10",
            "x-ratelimit-reset": "4102444800",
        },
    )
    with client_for(api) as client:
        client.get("/user")
        with pytest.raises(RateLimitError):
            client.assert_budget(1)


# ------------------------------------------------------------------- graphql


def test_graphql_returns_data(api: MockAPI) -> None:
    api.post("/graphql", json={"data": {"viewer": {"login": "elazamey"}}})
    with client_for(api) as client:
        result = client.graphql("query { viewer { login } }")
    assert result["viewer"]["login"] == "elazamey"
    assert result.ok


def test_graphql_errors_raise(api: MockAPI) -> None:
    api.post("/graphql", json={"data": None, "errors": [{"message": "Bad query"}]})
    with client_for(api) as client, pytest.raises(Exception, match="Bad query"):
        client.graphql("query { nope }")


def test_graphql_errors_can_be_returned(api: MockAPI) -> None:
    api.post("/graphql", json={"data": None, "errors": [{"message": "Bad query"}]})
    with client_for(api) as client:
        result = client.graphql("query {}", raise_on_error=False)
    assert not result.ok and result.first_error == "Bad query"


# --------------------------------------------------------------------- misc


def test_exists_handles_404(api: MockAPI) -> None:
    api.get("/orgs/acme/members/octocat", status=404, json={"message": "Not Found"})
    with client_for(api) as client:
        assert client.exists("/orgs/acme/members/octocat") is False


def test_token_setter_updates_header(api: MockAPI) -> None:
    api.get("/user", json={"login": "a"})
    with client_for(api) as client:
        client.token = "new-token"
        client.get("/user")
        assert api.calls[-1].headers["authorization"] == "Bearer new-token"
        client.token = None
        assert client.is_authenticated is False


def test_stream_yields_bytes(api: MockAPI) -> None:
    api.get("/repos/a/b/actions/runs/1/logs", text="log line\n")
    with client_for(api) as client:
        assert b"".join(client.stream("GET", "/repos/a/b/actions/runs/1/logs")) == b"log line\n"


def test_stream_raises_on_error(api: MockAPI) -> None:
    api.get("/repos/a/b/actions/runs/1/logs", status=404, json={"message": "Not Found"})
    with client_for(api) as client, pytest.raises(NotFoundError):
        b"".join(client.stream("GET", "/repos/a/b/actions/runs/1/logs"))


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("owner/repo", ("owner", "repo")),
        ("https://github.com/owner/repo", ("owner", "repo")),
        ("https://github.com/owner/repo.git", ("owner", "repo")),
        ("git@github.com:owner/repo.git", ("owner", "repo")),
    ],
)
def test_guess_repo_path_accepts_urls(value: str, expected: tuple[str, str]) -> None:
    assert guess_repo_path(value) == expected


@pytest.mark.parametrize("value", ["repo", "a/b/c", "https://github.com/onlyowner", ""])
def test_guess_repo_path_rejects_bad_input(value: str) -> None:
    with pytest.raises(ValueError):
        guess_repo_path(value)

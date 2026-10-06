"""Dashboard tests: the JSON API and the static UI."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.conftest import (
    MockAPI,
    issue_payload,
    pr_payload,
    repo_payload,
    run_payload,
    user_payload,
)
from twopro.web import create_app


@pytest.fixture
def client(api: MockAPI, gh) -> TestClient:
    app = create_app(github=gh)
    with TestClient(app) as test_client:
        yield test_client


# ------------------------------------------------------------------ static UI


def test_index_is_served(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "2pro" in response.text
    assert "app.js" in response.text


def test_static_assets(client: TestClient) -> None:
    for asset in ("app.js", "styles.css"):
        response = client.get(f"/static/{asset}")
        assert response.status_code == 200, asset
        assert len(response.text) > 100


# ---------------------------------------------------------------------- meta


def test_health(client: TestClient) -> None:
    data = client.get("/api/health").json()
    assert data["ok"] is True
    assert data["host"] == "github.com"
    assert data["authenticated"] is True


def test_me(client: TestClient, api: MockAPI) -> None:
    api.get("/user", json=user_payload("elazamey", name="Sayed"))
    data = client.get("/api/me").json()
    assert data["login"] == "elazamey"
    assert data["token"] == "explicit"


def test_rate_limit(client: TestClient, api: MockAPI) -> None:
    api.get(
        "/rate_limit",
        json={
            "resources": {
                "core": {"limit": 5000, "used": 679, "remaining": 4321, "reset": 4102444800}
            }
        },
    )
    data = client.get("/api/rate-limit").json()
    assert data["remaining"] == 4321
    assert data["limit"] == 5000


def test_rate_limit_snapshot_is_reused(client: TestClient, api: MockAPI) -> None:
    """A normal list response must not spend an extra call on /rate_limit."""
    api.get(
        "/user/repos",
        json=[repo_payload("2pro")],
        headers={
            "x-ratelimit-limit": "5000",
            "x-ratelimit-remaining": "4321",
            "x-ratelimit-used": "679",
            "x-ratelimit-reset": "4102444800",
        },
    )
    data = client.get("/api/repos").json()
    assert data["rate_limit"]["remaining"] == 4321
    assert not api.called("GET", "/rate_limit")


# --------------------------------------------------------------------- repos


def test_list_repos(client: TestClient, api: MockAPI) -> None:
    api.get("/user/repos", json=[repo_payload("2pro")])
    data = client.get("/api/repos").json()
    assert data["items"][0]["full_name"] == "elazamey/2pro"
    assert data["items"][0]["stars"] == 42


def test_search_repos(client: TestClient, api: MockAPI) -> None:
    api.get("/search/repositories", json={"items": [repo_payload("found")]})
    data = client.get("/api/repos?q=2pro").json()
    assert data["items"][0]["name"] == "found"


def test_repos_for_org_and_user(client: TestClient, api: MockAPI) -> None:
    api.get("/orgs/acme/repos", json=[repo_payload("x", owner="acme")])
    assert client.get("/api/repos?org=acme").json()["items"][0]["full_name"] == "acme/x"

    api.get("/users/octocat/repos", json=[repo_payload("hello", owner="octocat")])
    assert client.get("/api/repos?user=octocat").json()["items"][0]["name"] == "hello"


def test_repo_detail(client: TestClient, api: MockAPI) -> None:
    api.get("/repos/a/b", json=repo_payload("b", owner="a"))
    assert client.get("/api/repos/a/b").json()["full_name"] == "a/b"


def test_list_orgs(client: TestClient, api: MockAPI) -> None:
    api.get("/user/orgs", json=[{"login": "acme", "avatar_url": "https://x/y.png"}])
    assert client.get("/api/orgs").json()["items"][0]["login"] == "acme"


# -------------------------------------------------------------------- issues


def test_list_issues(client: TestClient, api: MockAPI) -> None:
    api.get("/repos/a/b/issues", json=[issue_payload(1, title="Broken")])
    data = client.get("/api/repos/a/b/issues").json()
    assert data["items"][0]["title"] == "Broken"
    assert data["items"][0]["labels"] == ["bug"]


def test_create_issue(client: TestClient, api: MockAPI) -> None:
    api.post("/repos/a/b/issues", json=issue_payload(12, title="From the UI"))
    response = client.post(
        "/api/repos/a/b/issues", json={"title": "From the UI", "body": "hello", "labels": ["bug"]}
    )
    assert response.status_code == 200
    assert response.json()["number"] == 12
    assert api.request_bodies()[0]["title"] == "From the UI"


def test_create_issue_validates_payload(client: TestClient) -> None:
    response = client.post("/api/repos/a/b/issues", json={"title": ""})
    assert response.status_code == 422


def test_comment_on_issue(client: TestClient, api: MockAPI) -> None:
    api.post("/repos/a/b/issues/1/comments", json={"id": 5, "html_url": "https://x"})
    response = client.post("/api/repos/a/b/issues/1/comments", json={"body": "nice"})
    assert response.status_code == 200
    assert response.json()["id"] == 5


def test_comment_requires_body(client: TestClient) -> None:
    assert client.post("/api/repos/a/b/issues/1/comments", json={"body": ""}).status_code == 422


def test_close_issue(client: TestClient, api: MockAPI) -> None:
    api.post("/repos/a/b/issues/1/comments", json={"id": 1})
    api.route("PATCH", "/repos/a/b/issues/1", json=issue_payload(1, state="closed"))
    response = client.post(
        "/api/repos/a/b/issues/1/close", json={"reason": "not_planned", "comment": "stale"}
    )
    assert response.status_code == 200
    assert response.json()["state"] == "closed"
    assert api.request_bodies()[0] == {"body": "stale"}
    assert api.request_bodies()[1]["state_reason"] == "not_planned"


# ---------------------------------------------------------------------- pulls


def test_list_pulls(client: TestClient, api: MockAPI) -> None:
    api.get("/repos/a/b/pulls", json=[pr_payload(5)])
    data = client.get("/api/repos/a/b/pulls").json()
    item = data["items"][0]
    assert item["number"] == 5 and item["head"] == "feature"


def test_merge_pull(client: TestClient, api: MockAPI) -> None:
    api.route("PUT", "/repos/a/b/pulls/5/merge", json={"merged": True, "message": "done"})
    response = client.post("/api/repos/a/b/pulls/5/merge", json={"method": "squash"})
    assert response.json()["merged"] is True
    assert api.request_bodies()[0] == {"merge_method": "squash"}


def test_merge_conflict_returns_409(client: TestClient, api: MockAPI) -> None:
    api.route(
        "PUT",
        "/repos/a/b/pulls/5/merge",
        json={"merged": False, "message": "Pull Request is not mergeable"},
    )
    response = client.post("/api/repos/a/b/pulls/5/merge", json={})
    assert response.status_code == 409
    assert "not mergeable" in response.json()["detail"]


# -------------------------------------------------------------------- actions


def test_list_workflows(client: TestClient, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/actions/workflows",
        json={"workflows": [{"id": 10, "name": "CI", "path": "ci.yml", "state": "active"}]},
    )
    assert client.get("/api/repos/a/b/workflows").json()["items"][0]["name"] == "CI"


def test_list_runs(client: TestClient, api: MockAPI) -> None:
    api.get("/repos/a/b/actions/runs", json={"workflow_runs": [run_payload(11)]})
    data = client.get("/api/repos/a/b/runs").json()
    assert data["items"][0]["id"] == 11
    assert data["items"][0]["icon"] == "✅"


def test_run_detail_with_jobs(client: TestClient, api: MockAPI) -> None:
    api.get("/repos/a/b/actions/runs/11", json=run_payload(11))
    api.get(
        "/repos/a/b/actions/runs/11/jobs",
        json={"jobs": [{"id": 1, "name": "build", "status": "completed", "conclusion": "success"}]},
    )
    data = client.get("/api/repos/a/b/runs/11").json()
    assert data["run"]["id"] == 11
    assert data["jobs"][0]["name"] == "build"


def test_rerun_and_cancel(client: TestClient, api: MockAPI) -> None:
    api.route("POST", "/repos/a/b/actions/runs/11/rerun", status=201)
    api.route("POST", "/repos/a/b/actions/runs/11/cancel", status=202)
    assert client.post("/api/repos/a/b/runs/11/rerun").json() == {"ok": True}
    assert client.post("/api/repos/a/b/runs/11/cancel").json() == {"ok": True}


def test_dispatch_workflow(client: TestClient, api: MockAPI) -> None:
    api.route("POST", "/repos/a/b/actions/workflows/ci.yml/dispatches", status=204)
    response = client.post(
        "/api/repos/a/b/workflows/ci.yml/dispatch", json={"ref": "main", "inputs": {"env": "prod"}}
    )
    assert response.json() == {"ok": True}
    assert api.request_bodies()[0]["inputs"] == {"env": "prod"}


# ----------------------------------------------------------------- automations


def test_digest_endpoint(client: TestClient, api: MockAPI) -> None:
    api.get("/repos/a/b/pulls", json=[])
    api.get("/repos/a/b/issues", json=[])
    api.get("/repos/a/b/actions/runs", json={"workflow_runs": []})
    api.get("/repos/a/b/releases", json=[])
    data = client.get("/api/repos/a/b/digest?days=7").json()
    assert "a/b" in data["markdown"]
    assert data["days"] == 7


def test_review_endpoint_does_not_post_by_default(client: TestClient, api: MockAPI) -> None:
    api.get("/repos/a/b/pulls/5", json=pr_payload(5))
    api.get("/repos/a/b/pulls/5/files", json=[])
    api.get("/repos/a/b/actions/runs", json={"workflow_runs": []})
    data = client.post("/api/repos/a/b/pulls/5/review?post=false").json()
    assert data["posted"] is False
    assert data["verdict"]


def test_review_endpoint_can_post(client: TestClient, api: MockAPI) -> None:
    api.get("/repos/a/b/pulls/5", json=pr_payload(5))
    api.get("/repos/a/b/pulls/5/files", json=[])
    api.get("/repos/a/b/actions/runs", json={"workflow_runs": []})
    api.get("/repos/a/b/issues/5/comments", json=[])
    api.post("/repos/a/b/issues/5/comments", json={"id": 1})
    data = client.post("/api/repos/a/b/pulls/5/review?post=true").json()
    assert data["posted"] is True


# ------------------------------------------------------------- error mapping


def test_github_404_is_mapped(client: TestClient, api: MockAPI) -> None:
    api.get("/repos/a/missing", status=404, json={"message": "Not Found"})
    response = client.get("/api/repos/a/missing")
    assert response.status_code == 404
    assert "Not Found" in response.json()["detail"]


def test_rate_limit_error_is_429(client: TestClient, api: MockAPI) -> None:
    api.get(
        "/repos/a/b",
        status=403,
        json={"message": "API rate limit exceeded"},
        headers={"x-ratelimit-remaining": "0", "x-ratelimit-reset": "4102444800"},
    )
    response = client.get("/api/repos/a/b")
    assert response.status_code == 429
    assert "reset_in" in response.json()


def test_server_errors_keep_their_status(client: TestClient, api: MockAPI) -> None:
    api.get("/repos/a/b", status=500, json={"message": "boom"})
    response = client.get("/api/repos/a/b")
    assert response.status_code == 500
    assert "boom" in response.json()["detail"]


def test_openapi_schema_is_available(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    assert schema["info"]["title"] == "2pro dashboard"
    assert "/api/repos" in schema["paths"]

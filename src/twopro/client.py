"""The HTTP core shared by the SDK, CLI, dashboard and automation.

Responsibilities kept in one place so every layer inherits them:

* authentication headers and GitHub Enterprise endpoints,
* retries with exponential backoff that respect ``Retry-After`` and
  ``X-RateLimit-Reset``,
* automatic pagination (``Link`` header, then ``page``/``per_page``),
* conditional requests (``ETag``/``304``) for cheap polling,
* typed errors and an always-current rate-limit snapshot,
* GraphQL in addition to REST.
"""

from __future__ import annotations

import contextlib
import random
import time
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx

from ._version import __version__
from .config import Settings, load_settings
from .errors import (
    GitHubError,
    RateLimitError,
    TransportError,
)
from .models import RateLimit

__all__ = ["GitHubClient", "GraphQLResult", "Page"]

RETRY_STATUS = frozenset({429, 500, 502, 503, 504})
MAX_BACKOFF = 30.0
# Endpoints that wrap their payload in an object rather than returning a list.
KNOWN_ITEM_KEYS = (
    "items",
    "workflow_runs",
    "workflows",
    "jobs",
    "artifacts",
    "repositories",
    "labels",
    "teams",
    "runners",
    "installations",
    "check_runs",
    "secrets",
)


@dataclass
class Page:
    """A single page plus the metadata GitHub returned with it."""

    items: list[Any]
    url: str
    etag: str | None = None
    rate_limit: RateLimit | None = None

    def __iter__(self) -> Iterator[Any]:  # pragma: no cover - convenience
        return iter(self.items)

    def __len__(self) -> int:  # pragma: no cover - convenience
        return len(self.items)


@dataclass
class GraphQLResult:
    """GraphQL response: ``data`` payload plus any ``errors`` array."""

    data: dict[str, Any] = field(default_factory=dict)
    errors: list[dict[str, Any]] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    @property
    def first_error(self) -> str:
        return str(self.errors[0].get("message", "unknown GraphQL error")) if self.errors else ""

    def __getitem__(self, key: str) -> Any:
        return self.data[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)


class GitHubClient:
    """A thin, opinionated GitHub REST/GraphQL client.

    >>> gh = GitHubClient()                       # token from env or `gh` CLI
    >>> gh.get("/rate_limit")["rate"]["limit"]
    5000
    """

    def __init__(
        self,
        token: str | None = None,
        *,
        settings: Settings | None = None,
        transport: httpx.BaseTransport | None = None,
        sleep: Any = None,
        **overrides: Any,
    ) -> None:
        self.settings = settings or load_settings(token=token, load_dotenv=False)
        if token:
            self.settings = self.settings.with_overrides(token=token)
        if overrides:
            self.settings = self.settings.with_overrides(**overrides)

        self._sleep = sleep or time.sleep
        self._etag_cache: dict[str, tuple[str, Any]] = {}
        self.last_response: httpx.Response | None = None
        self._rate_limit: RateLimit | None = None
        self.request_count = 0

        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": self.settings.api_version,
            "User-Agent": self.settings.user_agent or f"2pro/{__version__}",
        }
        if self.settings.token:
            headers["Authorization"] = f"Bearer {self.settings.token}"
        headers.update(self.settings.extra_headers)

        self._http = httpx.Client(
            base_url=self.settings.api_url,
            headers=headers,
            timeout=self.settings.timeout,
            transport=transport,
            verify=(self.settings.ca_bundle or self.settings.verify_ssl),
            follow_redirects=True,
        )

    # ------------------------------------------------------------------ setup

    @property
    def token(self) -> str | None:
        return self.settings.token

    @token.setter
    def token(self, value: str | None) -> None:
        self.settings.token = value
        if value:
            self._http.headers["Authorization"] = f"Bearer {value}"
        else:
            self._http.headers.pop("Authorization", None)

    @property
    def base_url(self) -> str:
        return self.settings.api_url

    @property
    def graphql_url(self) -> str:
        return self.settings.graphql_url

    @property
    def is_authenticated(self) -> bool:
        return bool(self.settings.token)

    @property
    def rate_limit(self) -> RateLimit | None:
        """Rate-limit state from the most recent response headers."""
        return self._rate_limit

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> GitHubClient:  # pragma: no cover - trivial
        return self

    def __exit__(self, *exc: object) -> None:  # pragma: no cover - trivial
        self.close()

    # --------------------------------------------------------------- requests

    def request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        json: Any = None,
        data: Any = None,
        headers: Mapping[str, str] | None = None,
        accept: str | None = None,
        use_cache: bool = False,
        raw: bool = False,
    ) -> httpx.Response:
        """Perform a request and return the ``httpx.Response``.

        Raises :class:`~twopro.errors.GitHubError` for 4xx/5xx responses and
        :class:`~twopro.errors.TransportError` when the network fails after
        ``max_retries`` attempts.
        """
        url = path
        request_headers = dict(headers or {})
        if accept:
            request_headers["Accept"] = accept

        cache_key = None
        if use_cache:
            cache_key = self._cache_key(method, url, params)
            cached = self._etag_cache.get(cache_key)
            if cached:
                request_headers["If-None-Match"] = cached[0]

        clean_params = _clean_params(params)
        response = self._send_with_retries(
            method,
            url,
            params=clean_params,
            json=json,
            data=data,
            headers=request_headers,
        )

        if response.status_code == 304 and cache_key:
            etag, body = self._etag_cache[cache_key]
            response = httpx.Response(
                200,
                request=response.request,
                json=body,
                headers={**response.headers, "x-2pro-cache": "hit", "etag": etag},
            )

        self.last_response = response
        self._track_rate_limit(response)

        if use_cache and response.status_code == 200:
            etag = response.headers.get("etag")
            if etag:
                with contextlib.suppress(ValueError):  # non-JSON body
                    self._etag_cache[cache_key] = (etag, response.json())

        if response.status_code >= 400:
            raise GitHubError.from_response(response)
        if raw:
            return response
        return response

    def _send_with_retries(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, Any] | None,
        json: Any,
        data: Any,
        headers: Mapping[str, str],
    ) -> httpx.Response:
        attempts = max(0, self.settings.max_retries)
        last_error: Exception | None = None

        for attempt in range(attempts + 1):
            try:
                self.request_count += 1
                response = self._http.request(
                    method,
                    url,
                    params=params or None,
                    json=json,
                    data=data,
                    headers=headers or None,
                )
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt >= attempts:
                    raise TransportError(f"Request to {url} failed: {exc}") from exc
                self._sleep(self._backoff(attempt))
                continue

            if response.status_code < 400 or response.status_code == 304:
                return response

            if self._should_retry(response) and attempt < attempts:
                wait = self._retry_wait(response, attempt)
                if wait is None:
                    break
                self._sleep(wait)
                continue
            return response

        if last_error:  # pragma: no cover - defensive
            raise TransportError(f"Request to {url} failed: {last_error}") from last_error
        raise TransportError(f"Request to {url} failed after {attempts + 1} attempts")

    def _should_retry(self, response: httpx.Response) -> bool:
        if response.status_code in RETRY_STATUS:
            return True
        if response.status_code == 403:
            text = _safe_text(response).lower()
            if "secondary rate" in text or "rate limit" in text:
                return bool(response.headers.get("retry-after")) or self.settings.wait_on_rate_limit
        return False

    def _retry_wait(self, response: httpx.Response, attempt: int) -> float | None:
        retry_after = response.headers.get("retry-after")
        if retry_after:
            try:
                return min(float(retry_after), MAX_BACKOFF * 4)
            except ValueError:  # pragma: no cover - malformed header
                pass
        reset = response.headers.get("x-ratelimit-reset")
        if reset and self.settings.wait_on_rate_limit:
            try:
                wait = float(reset) - time.time()
            except ValueError:  # pragma: no cover - malformed header
                wait = -1
            if 0 < wait <= 300:
                return wait + 1
            return None
        return self._backoff(attempt)

    def _backoff(self, attempt: int) -> float:
        return min(2**attempt + random.uniform(0, 0.4), MAX_BACKOFF)

    # ---------------------------------------------------------------- helpers

    def get(self, path: str, **kwargs: Any) -> Any:
        """``GET`` and return the decoded JSON body (``None`` for empty bodies)."""
        return _json_or_none(self.request("GET", path, **kwargs))

    def post(self, path: str, **kwargs: Any) -> Any:
        return _json_or_none(self.request("POST", path, **kwargs))

    def patch(self, path: str, **kwargs: Any) -> Any:
        return _json_or_none(self.request("PATCH", path, **kwargs))

    def put(self, path: str, **kwargs: Any) -> Any:
        return _json_or_none(self.request("PUT", path, **kwargs))

    def delete(self, path: str, **kwargs: Any) -> Any:
        return _json_or_none(self.request("DELETE", path, **kwargs))

    def head(self, path: str, **kwargs: Any) -> httpx.Response:
        return self.request("HEAD", path, raw=True, **kwargs)

    def stream(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> Iterator[bytes]:
        """Stream a response body (used for run logs and artifact downloads)."""
        with self._http.stream(
            method, path, params=_clean_params(params), headers=headers, follow_redirects=True
        ) as response:
            self.last_response = response
            self._track_rate_limit(response)
            if response.status_code >= 400:
                response.read()
                raise GitHubError.from_response(response)
            yield from response.iter_bytes()

    def exists(self, path: str, **kwargs: Any) -> bool:
        """Cheap ``HEAD``-style existence check that tolerates 404s."""
        try:
            self.request("GET", path, **kwargs)
        except GitHubError as exc:
            if exc.status_code == 404:
                return False
            raise
        return True

    # ------------------------------------------------------------- pagination

    def paginate(
        self,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        items_key: str | None = None,
        per_page: int | None = None,
        max_items: int | None = None,
        max_pages: int | None = None,
        use_cache: bool = False,
        accept: str | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> Iterator[Any]:
        """Yield every item across all pages of a collection endpoint."""
        emitted = 0
        for page in self.iter_pages(
            path,
            params=params,
            items_key=items_key,
            per_page=per_page,
            max_pages=max_pages,
            use_cache=use_cache,
            accept=accept,
            headers=headers,
        ):
            for item in page.items:
                yield item
                emitted += 1
                if max_items is not None and emitted >= max_items:
                    return

    def iter_pages(
        self,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        items_key: str | None = None,
        per_page: int | None = None,
        max_pages: int | None = None,
        use_cache: bool = False,
        accept: str | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> Iterator[Page]:
        """Yield :class:`Page` objects, following ``Link: rel="next"``."""
        page_size = per_page or self.settings.per_page
        query: dict[str, Any] = {"per_page": page_size}
        if params:
            query.update({k: v for k, v in params.items() if v is not None})
        next_url: str | None = path
        pages = 0
        seen_urls: set[str] = set()

        while next_url:
            if max_pages is not None and pages >= max_pages:
                return
            if next_url in seen_urls:
                return
            seen_urls.add(next_url)

            request_params = None if next_url.startswith(("http://", "https://")) else query
            response = self.request(
                "GET",
                next_url,
                params=request_params,
                use_cache=use_cache,
                accept=accept,
                headers=headers,
                raw=True,
            )
            pages += 1
            try:
                body = response.json()
            except ValueError:
                return
            items = _extract_items(body, items_key)
            yield Page(
                items=items,
                url=next_url,
                etag=response.headers.get("etag"),
                rate_limit=self._rate_limit,
            )

            next_url = _next_link(response.headers.get("link"))
            if not next_url and len(items) >= page_size and not _is_search(next_url, path):
                # Endpoints without a Link header: fall back to page numbers.
                if "page" not in query:
                    query["page"] = 2
                else:
                    query["page"] = int(query["page"]) + 1
                next_url = path
            if not items:
                return

    def get_all(self, path: str, **kwargs: Any) -> list[Any]:
        """Eagerly collect every page into a list."""
        return list(self.paginate(path, **kwargs))

    # ---------------------------------------------------------------- graphql

    def graphql(
        self,
        query: str,
        variables: Mapping[str, Any] | None = None,
        *,
        raise_on_error: bool = True,
    ) -> GraphQLResult:
        """Run a GraphQL query against ``/graphql``."""
        url = self.settings.graphql_url
        response = self.request(
            "POST",
            url,
            json={"query": query, "variables": dict(variables or {})},
            raw=True,
        )
        body = response.json() if response.content else {}
        result = GraphQLResult(
            data=body.get("data") or {},
            errors=body.get("errors") or [],
        )
        if raise_on_error and result.errors:
            raise GitHubError(result.first_error, status_code=response.status_code)
        return result

    # ------------------------------------------------------------ rate limits

    def rate_limit_status(self, *, refresh: bool = False) -> RateLimit:
        """Return the core rate-limit budget (cached until the next request)."""
        if refresh or self._rate_limit is None:
            data = self.get("/rate_limit")
            core = (data or {}).get("resources", {}).get("core") or data.get("rate") or {}
            self._rate_limit = RateLimit(**core, resource="core")
        return self._rate_limit

    def _track_rate_limit(self, response: httpx.Response) -> None:
        headers = response.headers
        limit = headers.get("x-ratelimit-limit")
        if limit is None:
            return
        with contextlib.suppress(TypeError, ValueError):  # malformed headers
            self._rate_limit = RateLimit(
                limit=int(limit),
                used=int(headers.get("x-ratelimit-used", 0) or 0),
                remaining=int(headers.get("x-ratelimit-remaining", 0) or 0),
                reset=int(float(headers.get("x-ratelimit-reset", 0) or 0)),
                resource=headers.get("x-ratelimit-resource") or "core",
            )

    def assert_budget(self, needed: int = 1) -> None:
        """Raise :class:`RateLimitError` before burning calls we do not have."""
        limit = self._rate_limit
        if limit and limit.remaining < needed and not self.settings.wait_on_rate_limit:
            raise RateLimitError(
                f"Only {limit.remaining} GitHub API calls left until {limit.reset_at:%H:%M:%S}",
                wait_seconds=limit.seconds_until_reset,
                status_code=403,
            )

    # ------------------------------------------------------------------ cache

    @staticmethod
    def _cache_key(method: str, url: str, params: Mapping[str, Any] | None) -> str:
        serialized = "&".join(f"{k}={v}" for k, v in sorted((params or {}).items()))
        return f"{method.upper()} {url}?{serialized}"

    def clear_cache(self) -> None:
        self._etag_cache.clear()


# --------------------------------------------------------------------------- #


def _json_or_none(response: httpx.Response) -> Any:
    if not response.content:
        return None
    if "json" not in response.headers.get("content-type", ""):
        return response.text
    return response.json()


def _clean_params(params: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not params:
        return None
    cleaned: dict[str, Any] = {}
    for key, value in params.items():
        if value is None:
            continue
        if isinstance(value, bool):
            cleaned[key] = "true" if value else "false"
        elif isinstance(value, (list, tuple, set)) or (
            isinstance(value, Sequence) and not isinstance(value, str)
        ):
            cleaned[key] = ",".join(str(v) for v in value)
        else:
            cleaned[key] = value
    return cleaned or None


def _safe_text(response: httpx.Response) -> str:
    try:
        return response.text
    except Exception:  # pragma: no cover - defensive
        return ""


def _next_link(link_header: str | None) -> str | None:
    if not link_header:
        return None
    for chunk in link_header.split(","):
        parts = chunk.split(";")
        if len(parts) < 2:
            continue
        url = parts[0].strip().strip("<>")
        for param in parts[1:]:
            key, _, value = param.strip().partition("=")
            if key == "rel" and value.strip().strip('"') == "next":
                return url
    return None


def _is_search(next_url: str | None, path: str) -> bool:
    target = next_url or path
    return "/search/" in target


def _extract_items(body: Any, items_key: str | None) -> list[Any]:
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        if items_key and isinstance(body.get(items_key), list):
            return list(body[items_key])
        if body.get("total_count") is not None and isinstance(body.get("items"), list):
            return list(body["items"])
        for key in KNOWN_ITEM_KEYS:
            if isinstance(body.get(key), list):
                return list(body[key])
    return []


def guess_repo_path(fragment: str) -> tuple[str, str]:
    """Split ``owner/repo`` (also accepts HTTPS and SSH GitHub URLs)."""
    value = (fragment or "").strip().rstrip("/")
    if "://" not in value and "@" in value and ":" in value:
        # scp-style remote: git@github.com:owner/repo.git
        value = value.split(":", 1)[1]
    if "://" in value or value.endswith(".git"):
        value = value.removesuffix(".git")
        parts = [p for p in urlsplit(value).path.strip("/").split("/") if p]
        if len(parts) >= 2:
            return parts[0], parts[1].removesuffix(".git")
        raise ValueError(f"Cannot parse a repository from {fragment!r}")
    if value.count("/") != 1:
        raise ValueError(f"Expected 'owner/repo', got {fragment!r}")
    owner, name = value.split("/")
    if not owner or not name:
        raise ValueError(f"Expected 'owner/repo', got {fragment!r}")
    return owner, name


def parse_link_params(url: str) -> dict[str, list[str]]:  # pragma: no cover - helper
    return parse_qs(urlsplit(url).query)
    return parse_qs(urlsplit(url).query)

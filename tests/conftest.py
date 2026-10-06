"""Shared test fixtures: a mock GitHub API and ready-made clients.

No test touches the network - every request is served by an ``httpx``
``MockTransport`` that replays canned responses and records the calls it got.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import pytest

from twopro.github import GitHub


class MockAPI:
    """A tiny request router that stands in for api.github.com."""

    def __init__(self) -> None:
        self.routes: dict[tuple[str, str], list[dict[str, Any]]] = {}
        self.calls: list[httpx.Request] = []

    # ------------------------------------------------------------------ setup

    def route(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        status: int = 200,
        headers: dict[str, str] | None = None,
        text: str | None = None,
    ) -> MockAPI:
        """Register a canned response.

        ``path`` may carry a query string; the params in it only have to be a
        subset of what the request sends, so tests do not depend on ordering.
        """
        from urllib.parse import parse_qsl

        base, _, query = path.partition("?")
        self.routes.setdefault((method.upper(), base), []).append(
            {
                "json": json,
                "status": status,
                "headers": headers or {},
                "text": text,
                "params": dict(parse_qsl(query)),
            }
        )
        return self

    def get(self, path: str, **kwargs: Any) -> MockAPI:
        return self.route("GET", path, **kwargs)

    def post(self, path: str, **kwargs: Any) -> MockAPI:
        return self.route("POST", path, **kwargs)

    # ---------------------------------------------------------------- queries

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)

    def handler(self, request: httpx.Request) -> httpx.Response:
        from urllib.parse import parse_qsl

        self.calls.append(request)
        candidates = [
            spec
            for (method, path), specs in self.routes.items()
            if method == request.method and path == request.url.path
            for spec in reversed(specs)  # later registrations win, like a re-route
        ]
        if not candidates:
            return httpx.Response(
                404,
                json={"message": f"mock: no route for {request.method} {request.url.path}"},
            )
        actual = dict(parse_qsl(request.url.query.decode()))
        exact = [s for s in candidates if s["params"] == actual]
        subset = [s for s in candidates if all(actual.get(k) == v for k, v in s["params"].items())]
        spec = (exact or subset or candidates)[0]
        return httpx.Response(
            spec["status"],
            json=spec["json"],
            text=spec["text"],
            headers=spec["headers"],
        )

    def request_bodies(self) -> list[dict[str, Any]]:
        """Decoded JSON bodies of every recorded request."""
        import json

        bodies = []
        for call in self.calls:
            if call.content:
                try:
                    bodies.append(json.loads(call.content))
                except ValueError:  # pragma: no cover - malformed fixture
                    continue
        return bodies

    def called(self, method: str, path: str) -> bool:
        return any(c.method == method.upper() and c.url.path == path for c in self.calls)


@pytest.fixture
def api() -> MockAPI:
    return MockAPI()


@pytest.fixture
def gh(api: MockAPI) -> GitHub:
    """A :class:`GitHub` wired to the mock API and an explicit token."""
    return GitHub("test-token", transport=api.transport, sleep=lambda *_: None)


@pytest.fixture
def no_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make retries instantaneous."""
    monkeypatch.setattr("time.sleep", lambda *_: None)


# --------------------------------------------------------------------------- #
# Payload factories
# --------------------------------------------------------------------------- #


def now_iso(offset_minutes: int = 0) -> str:
    moment = datetime.now(timezone.utc) + timedelta(minutes=offset_minutes)
    return moment.isoformat().replace("+00:00", "Z")


def repo_payload(name: str = "2pro", owner: str = "elazamey", **overrides: Any) -> dict[str, Any]:
    data = {
        "id": 1,
        "name": name,
        "full_name": f"{owner}/{name}",
        "owner": {"login": owner, "id": 10, "avatar_url": "https://example.com/a.png"},
        "private": False,
        "html_url": f"https://github.com/{owner}/{name}",
        "description": "A toolkit",
        "language": "Python",
        "stargazers_count": 42,
        "forks_count": 3,
        "open_issues_count": 7,
        "default_branch": "main",
        "topics": ["github", "cli"],
        "archived": False,
        "pushed_at": now_iso(-60),
        "created_at": now_iso(-10000),
        "updated_at": now_iso(-30),
    }
    data.update(overrides)
    return data


def user_payload(login: str = "elazamey", **overrides: Any) -> dict[str, Any]:
    data = {
        "login": login,
        "id": 99,
        "avatar_url": "https://example.com/u.png",
        "html_url": f"https://github.com/{login}",
        "name": "Sayed",
        "type": "User",
        "public_repos": 12,
        "followers": 5,
    }
    data.update(overrides)
    return data


def issue_payload(number: int = 1, **overrides: Any) -> dict[str, Any]:
    data = {
        "id": number * 10,
        "number": number,
        "title": f"Issue {number}",
        "body": "Something is broken",
        "state": "open",
        "user": user_payload(),
        "labels": [{"id": 1, "name": "bug", "color": "d73a4a"}],
        "comments": 2,
        "html_url": f"https://github.com/elazamey/2pro/issues/{number}",
        "created_at": now_iso(-5000),
        "updated_at": now_iso(-100),
    }
    data.update(overrides)
    return data


def pr_payload(number: int = 5, **overrides: Any) -> dict[str, Any]:
    data = {
        "id": number * 11,
        "number": number,
        "title": f"feat(api): improve #{number}",
        "body": "This adds pagination and fixes the sort order.",
        "state": "open",
        "user": user_payload(),
        "draft": False,
        "head": {"ref": "feature", "sha": "abc123"},
        "base": {"ref": "main", "sha": "def456"},
        "additions": 120,
        "deletions": 30,
        "changed_files": 4,
        "commits": 2,
        "requested_reviewers": [],
        "labels": [],
        "html_url": f"https://github.com/elazamey/2pro/pull/{number}",
        "created_at": now_iso(-300),
        "updated_at": now_iso(-10),
    }
    data.update(overrides)
    return data


def run_payload(run_id: int = 100, **overrides: Any) -> dict[str, Any]:
    data = {
        "id": run_id,
        "name": "CI",
        "display_title": "CI (#42)",
        "head_branch": "main",
        "head_sha": "deadbeefcafe",
        "run_number": 42,
        "event": "push",
        "status": "completed",
        "conclusion": "success",
        "actor": user_payload(),
        "html_url": f"https://github.com/elazamey/2pro/actions/runs/{run_id}",
        "created_at": now_iso(-20),
        "updated_at": now_iso(-19),
        "run_started_at": now_iso(-20),
    }
    data.update(overrides)
    return data


@pytest.fixture
def payloads() -> dict[str, Callable[..., dict[str, Any]]]:
    """Factories for the payloads above, exposed as a fixture."""
    return {
        "repo": repo_payload,
        "user": user_payload,
        "issue": issue_payload,
        "pr": pr_payload,
        "run": run_payload,
    }

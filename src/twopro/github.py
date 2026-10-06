"""The :class:`GitHub` facade - one object for the whole API surface."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from .auth import Credential, TokenSource, resolve_credential
from .client import GitHubClient, Page
from .config import Settings, load_settings
from .models import (
    Artifact,
    Issue,
    Job,
    PullRequest,
    RateLimit,
    Repository,
    User,
    Workflow,
    WorkflowRun,
)
from .resources import (
    ActionsResource,
    IssuesResource,
    OrgsResource,
    PullsResource,
    ReposResource,
    SearchResource,
    UsersResource,
)

__all__ = ["GitHub", "RepoHandle"]


class RepoHandle:
    """Convenience wrapper so you can write ``gh.repo("owner/name").runs()``."""

    def __init__(self, github: GitHub, owner: str, name: str) -> None:
        self._gh = github
        self.owner = owner
        self.name = name

    @property
    def full_name(self) -> str:
        return f"{self.owner}/{self.name}"

    def __str__(self) -> str:  # pragma: no cover - cosmetic
        return self.full_name

    def get(self) -> Repository:
        return self._gh.repos.get(self.owner, self.name)

    def issues(self, **kwargs: Any) -> Iterator[Issue]:
        return self._gh.issues.list(self.owner, self.name, **kwargs)

    def pulls(self, **kwargs: Any) -> Iterator[PullRequest]:
        return self._gh.pulls.list(self.owner, self.name, **kwargs)

    def runs(self, **kwargs: Any) -> Iterator[WorkflowRun]:
        return self._gh.actions.runs(self.owner, self.name, **kwargs)

    def workflows(self, **kwargs: Any) -> Iterator[Workflow]:
        return self._gh.actions.workflows(self.owner, self.name, **kwargs)

    def jobs(self, run_id: int, **kwargs: Any) -> Iterator[Job]:
        return self._gh.actions.jobs(self.owner, self.name, run_id, **kwargs)

    def artifacts(self, run_id: int, **kwargs: Any) -> Iterator[Artifact]:
        return self._gh.actions.artifacts(self.owner, self.name, run_id, **kwargs)


class GitHub:
    """Entry point for the 2pro SDK.

    >>> from twopro import GitHub
    >>> gh = GitHub()                       # token: env var, then `gh` CLI
    >>> gh.me().login
    'octocat'
    >>> [r.name for r in gh.repos.list_for_user("octocat")]
    ['Hello-World']
    """

    def __init__(
        self,
        token: str | None = None,
        *,
        settings: Settings | None = None,
        transport: Any = None,
        sleep: Any = None,
        auto_auth: bool = True,
        **overrides: Any,
    ) -> None:
        self.settings: Settings = settings or load_settings(token=token, **overrides)
        self.credential: Credential | None = None

        resolved_token = token or self.settings.token
        if resolved_token:
            self.credential = Credential(
                token=resolved_token,
                source=TokenSource.EXPLICIT if token else TokenSource.ENVIRONMENT,
                detail="--token" if token else "from environment / .env",
            )
        elif auto_auth:
            self.credential = resolve_credential(self.settings)
            resolved_token = self.credential.token

        self.client = GitHubClient(
            resolved_token,
            settings=self.settings,
            transport=transport,
            sleep=sleep,
            **overrides,
        )

        self.repos = ReposResource(self.client)
        self.issues = IssuesResource(self.client)
        self.pulls = PullsResource(self.client)
        self.actions = ActionsResource(self.client)
        self.users = UsersResource(self.client)
        self.orgs = OrgsResource(self.client)
        self.search = SearchResource(self.client)

    # ---------------------------------------------------------------- ergonomy

    def repo(self, owner: str, name: str | None = None) -> RepoHandle:
        """Return a :class:`RepoHandle`; accepts ``"owner/name"`` too."""
        if name is None:
            from .client import guess_repo_path

            owner, name = guess_repo_path(owner)
        return RepoHandle(self, owner, name)

    def me(self) -> User:
        return self.users.me()

    def rate_limit(self, *, refresh: bool = False) -> RateLimit:
        return self.client.rate_limit_status(refresh=refresh)

    def graphql(self, query: str, variables: dict[str, Any] | None = None) -> Any:
        return self.client.graphql(query, variables)

    def page(self, path: str, **kwargs: Any) -> Page:
        """The first page of a collection (kept for low-level use)."""
        for page in self.client.iter_pages(path, max_pages=1, **kwargs):
            return page
        return Page(items=[], url=path)

    # ------------------------------------------------------------------ dunder

    def close(self) -> None:
        self.client.close()

    def __enter__(self) -> GitHub:  # pragma: no cover - trivial
        return self

    def __exit__(self, *exc: object) -> None:  # pragma: no cover - trivial
        self.close()

    def __repr__(self) -> str:  # pragma: no cover - cosmetic
        host = self.settings.hostname
        authed = "authenticated" if self.client.is_authenticated else "anonymous"
        return f"<GitHub {host} {authed}>"

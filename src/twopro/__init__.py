"""2pro - a batteries-included toolkit for GitHub.

Three layers, one core:

* :mod:`twopro.client` - the typed HTTP client (auth, retries, pagination,
  rate limits, conditional requests, GraphQL).
* :mod:`twopro.resources` - resource oriented wrappers (repos, issues, pulls,
  actions, users, orgs) exposed through :class:`twopro.GitHub`.
* :mod:`twopro.cli` / :mod:`twopro.web` / :mod:`twopro.automation` - the CLI,
  the live dashboard and the CI automation built on top of the same core.

Quick start::

    from twopro import GitHub

    gh = GitHub()                      # token resolved from env or `gh` CLI
    for repo in gh.repos.list_for_authenticated_user():
        print(repo.full_name, repo.stargazers_count)
"""

from __future__ import annotations

from typing import Any

from ._version import __version__
from .client import GitHubClient
from .config import Settings, load_settings
from .errors import (
    AuthenticationError,
    AuthError,
    ConfigError,
    ForbiddenError,
    GitHubError,
    NotFoundError,
    RateLimitError,
    TransportError,
    TwoProError,
)
from .github import GitHub
from .models import (
    Artifact,
    Branch,
    Comment,
    Issue,
    Job,
    Label,
    Organization,
    PullRequest,
    RateLimit,
    Release,
    Repository,
    User,
    Workflow,
    WorkflowRun,
)

__all__ = [
    "Artifact",
    "AuthError",
    "AuthenticationError",
    "Branch",
    "Comment",
    "ConfigError",
    "ForbiddenError",
    "GitHub",
    "GitHubClient",
    "GitHubError",
    "Issue",
    "Job",
    "Label",
    "NotFoundError",
    "Organization",
    "PullRequest",
    "RateLimit",
    "RateLimitError",
    "Release",
    "Repository",
    "Settings",
    "TransportError",
    "TwoProError",
    "User",
    "Workflow",
    "WorkflowRun",
    "__version__",
    "load_settings",
]


def __getattr__(name: str) -> Any:  # pragma: no cover - lazy re-export
    if name == "GraphQLResult":
        from .client import GraphQLResult

        return GraphQLResult
    raise AttributeError(name)

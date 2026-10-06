"""Typed models for the GitHub REST API.

Models are intentionally forgiving: GitHub adds fields constantly, so unknown
keys are ignored and almost every field is optional.  Each model adds a few
convenience properties (``WorkflowRun.is_failure``,
``Repository.name_with_owner``, ...) that the CLI and dashboard rely on.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "Artifact",
    "Branch",
    "Comment",
    "Commit",
    "Issue",
    "Job",
    "JobStep",
    "Label",
    "License",
    "Milestone",
    "Organization",
    "Permissions",
    "PullRequest",
    "RateLimit",
    "Ref",
    "Release",
    "Repository",
    "RepositoryRef",
    "Review",
    "SearchResult",
    "User",
    "Workflow",
    "WorkflowRun",
]

T = TypeVar("T")

STATUS_ICONS = {
    "completed_success": "✅",
    "completed_failure": "❌",
    "completed_cancelled": "⏹️",
    "completed_skipped": "⏭️",
    "completed_timed_out": "⏰",
    "completed_action_required": "⚠️",
    "completed_neutral": "⚪",
    "completed_startup_failure": "💥",
    "completed_stale": "🍂",
    "in_progress": "🔄",
    "queued": "⏳",
    "waiting": "⏳",
    "requested": "⏳",
    "pending": "⏳",
}


class GitHubModel(BaseModel):
    """Base model: ignore unknown keys, allow population by field name."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(GitHubModel):
    login: str
    id: int | None = None
    node_id: str | None = None
    avatar_url: str | None = None
    html_url: str | None = None
    type: str | None = None
    name: str | None = None
    email: str | None = None
    company: str | None = None
    blog: str | None = None
    location: str | None = None
    bio: str | None = None
    public_repos: int | None = None
    public_gists: int | None = None
    followers: int | None = None
    following: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    site_admin: bool | None = None

    @property
    def display_name(self) -> str:
        return self.name or self.login

    def __str__(self) -> str:  # pragma: no cover - cosmetic
        return self.login


class License(GitHubModel):
    key: str | None = None
    name: str | None = None
    spdx_id: str | None = None
    url: str | None = None


class Permissions(GitHubModel):
    admin: bool = False
    maintain: bool | None = None
    push: bool = False
    triage: bool | None = None
    pull: bool = False


class RepositoryRef(GitHubModel):
    """The trimmed repository object embedded in issues, runs, etc."""

    id: int
    node_id: str | None = None
    name: str
    full_name: str | None = None
    owner: User | None = None
    private: bool | None = None
    html_url: str | None = None
    url: str | None = None


class Repository(GitHubModel):
    id: int
    node_id: str | None = None
    name: str
    full_name: str | None = None
    owner: User | None = None
    private: bool = False
    html_url: str | None = None
    description: str | None = None
    fork: bool = False
    url: str | None = None
    homepage: str | None = None
    language: str | None = None
    size: int = 0
    stargazers_count: int = 0
    watchers_count: int = 0
    forks_count: int = 0
    open_issues_count: int = 0
    subscribers_count: int | None = None
    default_branch: str = "main"
    topics: list[str] = Field(default_factory=list)
    license: License | None = None
    permissions: Permissions | None = None
    archived: bool = False
    disabled: bool = False
    visibility: str | None = None
    pushed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @property
    def name_with_owner(self) -> str:
        if self.full_name:
            return self.full_name
        if self.owner:
            return f"{self.owner.login}/{self.name}"
        return self.name

    # Backwards/forwards friendly alias used across the codebase and UI.
    @property
    def owner_login(self) -> str:
        return self.owner.login if self.owner else (self.full_name or "").split("/")[0]

    @property
    def is_archived(self) -> bool:
        return self.archived

    @property
    def stars(self) -> int:
        return self.stargazers_count


class Label(GitHubModel):
    id: int | None = None
    node_id: str | None = None
    name: str
    color: str | None = None
    description: str | None = None
    default: bool | None = None

    def __str__(self) -> str:  # pragma: no cover - cosmetic
        return self.name


class Milestone(GitHubModel):
    id: int | None = None
    number: int | None = None
    title: str | None = None
    description: str | None = None
    state: str | None = None
    due_on: datetime | None = None
    html_url: str | None = None


class Comment(GitHubModel):
    id: int | None = None
    node_id: str | None = None
    body: str | None = None
    user: User | None = None
    author_association: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    html_url: str | None = None
    reactions: dict[str, Any] | None = None


class Issue(GitHubModel):
    id: int | None = None
    node_id: str | None = None
    number: int
    title: str
    body: str | None = None
    state: str = "open"
    state_reason: str | None = None
    user: User | None = None
    labels: list[Label] = Field(default_factory=list)
    assignee: User | None = None
    assignees: list[User] = Field(default_factory=list)
    milestone: Milestone | None = None
    comments: int = 0
    locked: bool = False
    draft: bool | None = None
    author_association: str | None = None
    html_url: str | None = None
    url: str | None = None
    repository_url: str | None = None
    pull_request: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    closed_at: datetime | None = None

    @property
    def is_pull_request(self) -> bool:
        return self.pull_request is not None

    @property
    def label_names(self) -> list[str]:
        return [label.name for label in self.labels]

    @property
    def is_closed(self) -> bool:
        return self.state == "closed"

    @property
    def age_days(self) -> float | None:
        if not self.created_at:
            return None
        return (_now() - self.created_at).total_seconds() / 86400


class Ref(GitHubModel):
    label: str | None = None
    ref: str
    sha: str
    user: User | None = None
    repo: RepositoryRef | None = None


class PullRequest(GitHubModel):
    id: int | None = None
    node_id: str | None = None
    number: int
    title: str
    body: str | None = None
    state: str = "open"
    user: User | None = None
    draft: bool = False
    merged: bool | None = None
    merged_at: datetime | None = None
    merged_by: User | None = None
    merge_commit_sha: str | None = None
    mergeable: bool | None = None
    mergeable_state: str | None = None
    rebaseable: bool | None = None
    head: Ref | None = None
    base: Ref | None = None
    labels: list[Label] = Field(default_factory=list)
    assignee: User | None = None
    assignees: list[User] = Field(default_factory=list)
    requested_reviewers: list[User] = Field(default_factory=list)
    requested_teams: list[Any] = Field(default_factory=list)
    milestone: Milestone | None = None
    additions: int = 0
    deletions: int = 0
    changed_files: int = 0
    commits: int = 0
    comments: int = 0
    review_comments: int = 0
    maintainer_can_modify: bool | None = None
    html_url: str | None = None
    url: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    closed_at: datetime | None = None

    @property
    def label_names(self) -> list[str]:
        return [label.name for label in self.labels]

    @property
    def is_merged(self) -> bool:
        return bool(self.merged or self.merged_at)

    @property
    def total_changes(self) -> int:
        return self.additions + self.deletions

    @property
    def head_ref(self) -> str | None:
        return self.head.ref if self.head else None

    @property
    def base_ref(self) -> str | None:
        return self.base.ref if self.base else None


class Review(GitHubModel):
    id: int | None = None
    user: User | None = None
    body: str | None = None
    state: str | None = None
    commit_id: str | None = None
    submitted_at: datetime | None = None
    html_url: str | None = None


class Commit(GitHubModel):
    sha: str
    node_id: str | None = None
    commit: dict[str, Any] | None = None
    author: User | None = None
    committer: User | None = None
    html_url: str | None = None
    stats: dict[str, Any] | None = None
    files: list[dict[str, Any]] = Field(default_factory=list)

    @property
    def message(self) -> str:
        if self.commit and isinstance(self.commit, dict):
            return str(self.commit.get("message", ""))
        return ""

    @property
    def short_sha(self) -> str:
        return self.sha[:8]


class Branch(GitHubModel):
    name: str
    commit: Commit | None = None
    protected: bool = False

    @property
    def sha(self) -> str | None:
        return self.commit.sha if self.commit else None


class Release(GitHubModel):
    id: int | None = None
    node_id: str | None = None
    tag_name: str
    name: str | None = None
    body: str | None = None
    draft: bool = False
    prerelease: bool = False
    author: User | None = None
    html_url: str | None = None
    created_at: datetime | None = None
    published_at: datetime | None = None
    assets: list[dict[str, Any]] = Field(default_factory=list)


class Workflow(GitHubModel):
    id: int
    node_id: str | None = None
    name: str
    path: str | None = None
    state: str | None = None
    badge_url: str | None = None
    html_url: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class WorkflowRun(GitHubModel):
    id: int
    name: str | None = None
    node_id: str | None = None
    display_title: str | None = None
    head_branch: str | None = None
    head_sha: str | None = None
    path: str | None = None
    run_number: int | None = None
    run_attempt: int | None = None
    event: str | None = None
    status: str | None = None
    conclusion: str | None = None
    workflow_id: int | None = None
    workflow_name: str | None = None
    url: str | None = None
    html_url: str | None = None
    actor: User | None = None
    triggering_actor: User | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    run_started_at: datetime | None = None
    jobs_url: str | None = None
    logs_url: str | None = None
    check_suite_id: int | None = None

    @property
    def is_completed(self) -> bool:
        return self.status == "completed"

    @property
    def is_success(self) -> bool:
        return self.conclusion == "success"

    @property
    def is_failure(self) -> bool:
        return self.conclusion in {"failure", "timed_out", "startup_failure", "stale"}

    @property
    def duration(self) -> timedelta | None:
        start = self.run_started_at or self.created_at
        end = self.updated_at if self.is_completed else _now()
        if not start:
            return None
        return end - start

    @property
    def duration_seconds(self) -> float | None:
        delta = self.duration
        return delta.total_seconds() if delta is not None else None

    @property
    def icon(self) -> str:
        key = (
            f"{self.status}_{self.conclusion}"
            if self.status == "completed"
            else (self.status or "")
        )
        return STATUS_ICONS.get(key, "❔")

    @property
    def label(self) -> str:
        return self.display_title or self.name or f"run #{self.run_number or self.id}"


class JobStep(GitHubModel):
    name: str
    status: str | None = None
    conclusion: str | None = None
    number: int | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None


class Job(GitHubModel):
    id: int
    run_id: int | None = None
    name: str
    status: str | None = None
    conclusion: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    html_url: str | None = None
    steps: list[JobStep] = Field(default_factory=list)

    @property
    def icon(self) -> str:
        key = (
            f"{self.status}_{self.conclusion}"
            if self.status == "completed"
            else (self.status or "")
        )
        return STATUS_ICONS.get(key, "❔")

    @property
    def duration_seconds(self) -> float | None:
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None


class Artifact(GitHubModel):
    id: int
    node_id: str | None = None
    name: str
    size_in_bytes: int = 0
    archive_download_url: str | None = None
    expired: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None
    expires_at: datetime | None = None

    @property
    def size_human(self) -> str:
        size = float(self.size_in_bytes)
        for unit in ("B", "KB", "MB", "GB"):
            if size < 1024 or unit == "GB":
                return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} GB"  # pragma: no cover - unreachable


class Organization(GitHubModel):
    login: str
    id: int | None = None
    node_id: str | None = None
    description: str | None = None
    name: str | None = None
    avatar_url: str | None = None
    html_url: str | None = None
    public_repos: int | None = None
    followers: int | None = None
    following: int | None = None
    created_at: datetime | None = None


class RateLimit(GitHubModel):
    limit: int = 0
    used: int = 0
    remaining: int = 0
    reset: int = 0
    resource: str | None = None

    @property
    def reset_at(self) -> datetime | None:
        if not self.reset:
            return None
        return datetime.fromtimestamp(self.reset, tz=timezone.utc)

    @property
    def seconds_until_reset(self) -> float:
        if not self.reset:
            return 0.0
        return max(0.0, self.reset - _now().timestamp())

    @property
    def is_exhausted(self) -> bool:
        return self.remaining <= 0

    @property
    def used_ratio(self) -> float:
        return (self.used / self.limit) if self.limit else 0.0


class SearchResult(GitHubModel, Generic[T]):
    total_count: int = 0
    incomplete_results: bool = False
    items: list[T] = Field(default_factory=list)

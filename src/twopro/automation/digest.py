"""A markdown activity digest for a repository - perfect as a CI job summary.

$ 2pro automate digest owner/repo --days 7 > digest.md
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from ..github import GitHub

__all__ = ["Digest", "DigestReport", "build_digest"]


@dataclass
class Digest:
    """The numbers behind a digest report."""

    repo: str
    since: datetime
    merged: list[Any] = field(default_factory=list)
    opened_prs: list[Any] = field(default_factory=list)
    opened_issues: list[Any] = field(default_factory=list)
    closed_issues: list[Any] = field(default_factory=list)
    failed_runs: list[Any] = field(default_factory=list)
    releases: list[Any] = field(default_factory=list)
    contributors: Counter = field(default_factory=Counter)

    @property
    def days(self) -> int:
        return max(1, (datetime.now(timezone.utc) - self.since).days)

    @property
    def total_changes(self) -> int:
        return sum(pr.total_changes for pr in self.merged if hasattr(pr, "total_changes"))

    @property
    def health(self) -> str:
        """A one-line verdict: green / warning / red."""
        if self.failed_runs and len(self.failed_runs) > 5:
            return "🔴 CI is failing repeatedly"
        if self.failed_runs:
            return "🟡 Some CI runs failed"
        if self.merged:
            return "🟢 Shipping steadily"
        return "⚪ Quiet period"


@dataclass
class DigestReport:
    """Rendered digest."""

    digest: Digest
    markdown: str

    def __str__(self) -> str:  # pragma: no cover - cosmetic
        return self.markdown


def build_digest(
    gh: GitHub,
    repo: str,
    *,
    days: int = 7,
    include_actions: bool = True,
    include_releases: bool = True,
) -> DigestReport:
    """Collect the last ``days`` days of activity into a markdown report."""
    from ..client import guess_repo_path

    owner, name = guess_repo_path(repo)
    since = datetime.now(timezone.utc) - timedelta(days=days)
    digest = Digest(repo=f"{owner}/{name}", since=since)

    for pr in gh.pulls.list(
        owner, name, state="all", sort="updated", direction="desc", max_items=200
    ):
        updated = pr.updated_at or pr.created_at
        if not updated:
            continue
        if updated.tzinfo is None:  # pragma: no cover - defensive
            updated = updated.replace(tzinfo=timezone.utc)
        if updated < since:
            continue
        if pr.is_merged:
            digest.merged.append(pr)
            if pr.user:
                digest.contributors[pr.user.login] += 1
        elif pr.created_at and updated.replace(tzinfo=timezone.utc) >= since and pr.state == "open":
            digest.opened_prs.append(pr)

    for issue in gh.issues.list(
        owner, name, state="all", sort="updated", direction="desc", max_items=200
    ):
        updated = issue.updated_at or issue.created_at
        if not updated:
            continue
        if updated.tzinfo is None:  # pragma: no cover - defensive
            updated = updated.replace(tzinfo=timezone.utc)
        if updated < since:
            continue
        if issue.state == "closed":
            digest.closed_issues.append(issue)
        else:
            digest.opened_issues.append(issue)

    if include_actions:
        for run in gh.actions.runs(owner, name, max_items=60):
            created = run.created_at
            if created and created.tzinfo is None:  # pragma: no cover - defensive
                created = created.replace(tzinfo=timezone.utc)
            if not created or created < since:
                continue
            if run.is_failure:
                digest.failed_runs.append(run)

    if include_releases:
        for release in gh.repos.releases(owner, name, max_items=10):
            published = release.published_at or release.created_at
            if published and published.tzinfo is None:  # pragma: no cover - defensive
                published = published.replace(tzinfo=timezone.utc)
            if published and published >= since:
                digest.releases.append(release)

    return DigestReport(digest=digest, markdown=_render(digest))


def _render(digest: Digest) -> str:
    lines: list[str] = []
    lines.append(f"## 📊 {digest.repo} - last {digest.days} day(s)")
    lines.append("")
    lines.append(f"**{digest.health}**")
    lines.append("")

    merged_line = f"- ✅ **{len(digest.merged)}** pull requests merged"
    if digest.total_changes:
        merged_line += f" ({digest.total_changes} lines changed)"
    lines.append(merged_line)
    lines.append(f"- 🆕 **{len(digest.opened_prs)}** pull requests still open")
    lines.append(
        f"- 🐛 **{len(digest.opened_issues)}** issues opened, "
        f"**{len(digest.closed_issues)}** closed"
    )
    if digest.releases:
        lines.append(f"- 🚀 **{len(digest.releases)}** releases published")
    if digest.failed_runs:
        lines.append(f"- ❌ **{len(digest.failed_runs)}** failed workflow runs")
    lines.append("")

    if digest.merged:
        lines.append("### Merged pull requests")
        lines.append("")
        lines.append("| PR | Author | Changes |")
        lines.append("| --- | --- | --- |")
        for pr in digest.merged[:20]:
            author = pr.user.login if pr.user else "?"
            lines.append(
                f"| #{pr.number} {_escape(pr.title)} | @{author} | "
                f"+{pr.additions}/-{pr.deletions} |"
            )
        lines.append("")

    if digest.failed_runs:
        lines.append("### Failed workflow runs")
        lines.append("")
        for run in digest.failed_runs[:10]:
            title = _escape(run.label)[:70]
            lines.append(f"- ❌ [{title}]({run.html_url}) - `{run.head_branch}`")
        lines.append("")

    if digest.contributors:
        lines.append("### Top contributors")
        lines.append("")
        for login, count in digest.contributors.most_common(5):
            lines.append(f"- @{login} - {count} merged PR(s)")
        lines.append("")

    if not (digest.merged or digest.opened_issues or digest.failed_runs):
        lines.append("_No activity in this window._")
        lines.append("")

    lines.append(
        f"<sub>Generated by <b>2pro</b> on {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC</sub>"
    )
    return "\n".join(lines)


def _escape(text: str | None) -> str:
    return (text or "").replace("|", "\\|").replace("\n", " ").strip()

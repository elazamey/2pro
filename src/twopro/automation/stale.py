"""Mark inactive issues (and pull requests) as stale, then close them.

A typical weekly cron::

    2pro automate stale owner/repo --days 60 --close-after 14
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from ..github import GitHub

__all__ = ["CLOSE_COMMENT", "STALE_COMMENT", "StaleItem", "StaleReport", "sweep_stale"]

STALE_LABEL = "stale"
EXEMPT_LABELS = frozenset({"pinned", "security", "epic", "roadmap", "no-stale"})

STALE_COMMENT = (
    "👋 This {kind} has had no activity for {days} days, so it has been marked "
    "as **stale**. It will be closed in {close_days} days unless there is new "
    "activity. Remove the `stale` label or leave a comment to keep it open."
)
CLOSE_COMMENT = (
    "🔒 Closing this {kind} because it has been stale for {close_days} days. "
    "Feel free to reopen it if it is still relevant."
)


@dataclass
class StaleItem:
    """A single issue the sweeper touched."""

    number: int
    title: str
    kind: str
    days_idle: float
    action: str  # "marked" | "closed" | "skipped"
    url: str = ""

    def __str__(self) -> str:  # pragma: no cover - cosmetic
        return f"#{self.number} {self.action} ({self.days_idle:.0f}d idle)"


@dataclass
class StaleReport:
    """Aggregate result of one sweep."""

    repo: str
    stale_days: int = 0
    close_days: int = 0
    scanned: int = 0
    marked: list[StaleItem] = field(default_factory=list)
    closed: list[StaleItem] = field(default_factory=list)
    skipped: list[StaleItem] = field(default_factory=list)
    dry_run: bool = False

    @property
    def changed(self) -> int:
        return len(self.marked) + len(self.closed)

    @property
    def markdown(self) -> str:
        lines = [
            f"### 🧹 Stale sweep for `{self.repo}`",
            "",
            f"- scanned **{self.scanned}** open items",
            f"- marked stale: **{len(self.marked)}**",
            f"- closed: **{len(self.closed)}**",
            f"- untouched (exempt or still active): **{len(self.skipped)}**",
        ]
        if self.dry_run:
            lines.append("")
            lines.append("> dry run - no comments, labels or state changes were written")
        if self.marked or self.closed:
            lines.append("")
            lines.append("| Item | Idle | Action |")
            lines.append("| --- | --- | --- |")
            for item in self.marked + self.closed:
                lines.append(
                    f"| #{item.number} {item.title[:60]} | {item.days_idle:.0f}d | {item.action} |"
                )
        return "\n".join(lines)


def sweep_stale(
    gh: GitHub,
    repo: str,
    *,
    stale_days: int = 60,
    close_days: int = 14,
    stale_label: str = STALE_LABEL,
    exempt_labels: frozenset[str] | set[str] = EXEMPT_LABELS,
    limit: int | None = None,
    dry_run: bool = True,
    include_pulls: bool = True,
    comment: bool = True,
) -> StaleReport:
    """Mark idle issues stale; close the ones that stayed stale."""
    from ..client import guess_repo_path

    owner, name = guess_repo_path(repo)
    now = datetime.now(timezone.utc)
    stale_cutoff = now - timedelta(days=stale_days)
    close_cutoff = now - timedelta(days=close_days)

    report = StaleReport(repo=repo, stale_days=stale_days, close_days=close_days, dry_run=dry_run)
    issues = gh.issues.list_all(owner, name, state="open", sort="updated", direction="asc")

    for issue in issues:
        if limit and report.scanned >= limit:
            break
        report.scanned += 1

        labels = set(issue.label_names)
        kind = "pull request" if issue.is_pull_request else "issue"
        if not include_pulls and issue.is_pull_request:
            report.skipped.append(
                StaleItem(issue.number, issue.title, kind, 0.0, "skipped", issue.html_url or "")
            )
            continue
        if labels & set(exempt_labels):
            report.skipped.append(
                StaleItem(issue.number, issue.title, kind, 0.0, "skipped", issue.html_url or "")
            )
            continue

        updated = issue.updated_at or issue.created_at
        if updated is None:
            continue
        if updated.tzinfo is None:  # pragma: no cover - defensive
            updated = updated.replace(tzinfo=timezone.utc)
        idle_days = (now - updated).total_seconds() / 86400

        if stale_label in labels:
            if updated <= close_cutoff:
                if not dry_run:
                    if comment:
                        gh.issues.comment(
                            owner,
                            name,
                            issue.number,
                            CLOSE_COMMENT.format(kind=kind, close_days=close_days),
                        )
                    gh.issues.close(owner, name, issue.number, reason="not_planned")
                report.closed.append(
                    StaleItem(
                        issue.number, issue.title, kind, idle_days, "closed", issue.html_url or ""
                    )
                )
            else:
                report.skipped.append(
                    StaleItem(
                        issue.number, issue.title, kind, idle_days, "skipped", issue.html_url or ""
                    )
                )
            continue

        if updated <= stale_cutoff:
            if not dry_run:
                gh.issues.add_labels(owner, name, issue.number, [stale_label])
                if comment:
                    gh.issues.comment(
                        owner,
                        name,
                        issue.number,
                        STALE_COMMENT.format(kind=kind, days=stale_days, close_days=close_days),
                    )
            report.marked.append(
                StaleItem(
                    issue.number, issue.title, kind, idle_days, "marked", issue.html_url or ""
                )
            )
        else:
            report.skipped.append(
                StaleItem(
                    issue.number, issue.title, kind, idle_days, "skipped", issue.html_url or ""
                )
            )

    return report

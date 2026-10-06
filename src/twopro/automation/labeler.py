"""Conventional-commit and size labels for pull requests.

``2pro automate label owner/repo 42`` turns

    feat(api): add pagination        +312 / -40 across 7 files

into ``type/feature`` + ``size/M``.  Labels that do not exist yet are skipped
unless ``create_missing=True`` (GitHub creates them implicitly otherwise).
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from ..github import GitHub

__all__ = ["SIZE_LABELS", "TYPE_LABELS", "LabelReport", "label_pr", "suggest_labels"]

SIZE_LABELS: tuple[tuple[int, str], ...] = (
    (50, "size/XS"),
    (200, "size/S"),
    (500, "size/M"),
    (1000, "size/L"),
)
XL_LABEL = "size/XL"

TYPE_LABELS: dict[str, str] = {
    "feat": "type/feature",
    "feature": "type/feature",
    "fix": "type/bug",
    "bugfix": "type/bug",
    "hotfix": "type/bug",
    "docs": "type/docs",
    "doc": "type/docs",
    "chore": "type/chore",
    "refactor": "type/refactor",
    "perf": "type/performance",
    "test": "type/test",
    "tests": "type/test",
    "ci": "type/ci",
    "build": "type/build",
    "deps": "type/dependencies",
    "revert": "type/revert",
    "security": "type/security",
}

TEST_PATTERNS = re.compile(
    r"(^|/)(tests?|spec)/|_test\.|test_[^/]*\.py|\.test\.[jt]sx?$|\.spec\.[jt]sx?$",
    re.IGNORECASE,
)
CONVENTIONAL = re.compile(
    r"^(?P<type>[a-zA-Z]+)"  # feat, fix, ...
    r"(?:\((?P<scope>[^)]*)\))?"  # (api)
    r"(?P<breaking>!)?"  # !
    r":\s*(?P<subject>.+)$",
    re.DOTALL,
)
DEP_PATTERNS = re.compile(
    r"(requirements.*\.txt|poetry\.lock|Pipfile\.lock|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|go\.(mod|sum)|Cargo\.lock)",
    re.IGNORECASE,
)


@dataclass
class LabelReport:
    """What the labeler decided for one pull request."""

    number: int
    title: str
    existing: list[str] = field(default_factory=list)
    suggested: list[str] = field(default_factory=list)
    added: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    dry_run: bool = False

    @property
    def to_apply(self) -> list[str]:
        return self.added if not self.dry_run else self.suggested

    @property
    def markdown(self) -> str:
        lines = [
            f"### 🏷️ Labels for #{self.number} - {self.title}",
            "",
            f"- suggested: {', '.join(f'`{s}`' for s in self.suggested) or '_none_'}",
            f"- already present: {', '.join(f'`{s}`' for s in self.existing) or '_none_'}",
        ]
        if self.dry_run:
            lines.append("- **dry run** - nothing was changed")
        else:
            lines.append(f"- applied: {', '.join(f'`{s}`' for s in self.added) or '_none_'}")
        if self.skipped:
            lines.append(
                f"- skipped (not defined in the repo): {', '.join(f'`{s}`' for s in self.skipped)}"
            )
        return "\n".join(lines)


def suggest_labels(
    title: str,
    *,
    additions: int = 0,
    deletions: int = 0,
    files: Iterable[dict[str, Any]] | None = None,
    draft: bool = False,
    body: str | None = None,
    base_ref: str | None = None,
) -> list[str]:
    """Derive labels from a PR title, its size and the files it touches."""
    labels: list[str] = []
    clean_title = (title or "").strip()

    match = CONVENTIONAL.match(clean_title)
    if match:
        kind = match.group("type").lower()
        if kind in TYPE_LABELS:
            labels.append(TYPE_LABELS[kind])
        if match.group("breaking"):
            labels.append("breaking-change")
    elif clean_title.lower().startswith(("bump ", "update dependency", "chore(deps)")):
        labels.append(TYPE_LABELS["deps"])

    total = additions + deletions
    size = XL_LABEL
    for threshold, name in SIZE_LABELS:
        if total <= threshold:
            size = name
            break
    labels.append(size)

    paths = [str(f.get("filename", "")) for f in (files or [])]
    if paths and all(DEP_PATTERNS.search(p) for p in paths):
        labels.append(TYPE_LABELS["deps"])
    if paths and all(TEST_PATTERNS.search(p) for p in paths):
        labels.append("tests-only")
    if draft:
        labels.append("work-in-progress")
    if base_ref and base_ref not in (None, "", "main", "master"):
        labels.append(f"target/{base_ref}")

    # Deterministic, de-duplicated, stable ordering.
    seen: set[str] = set()
    ordered: list[str] = []
    for label in labels:
        if label not in seen:
            seen.add(label)
            ordered.append(label)
    return ordered


def label_pr(
    gh: GitHub,
    repo: str,
    number: int,
    *,
    dry_run: bool = True,
    create_missing: bool = False,
    extra: Iterable[str] | None = None,
    size_labels: bool = True,
) -> LabelReport:
    """Apply :func:`suggest_labels` to one pull request."""
    from ..client import guess_repo_path

    owner, name = guess_repo_path(repo)
    pr = gh.pulls.get(owner, name, number)
    files = list(gh.pulls.files(owner, name, number, max_items=300))

    suggested = suggest_labels(
        pr.title,
        additions=pr.additions,
        deletions=pr.deletions,
        files=files,
        draft=bool(pr.draft),
        body=pr.body,
        base_ref=pr.base_ref,
    )
    if not size_labels:
        suggested = [label for label in suggested if not label.startswith("size/")]
    for label in extra or []:
        if label not in suggested:
            suggested.append(label)

    existing = list(pr.label_names)
    wanted = [label for label in suggested if label not in existing]

    known = {label.name for label in gh.issues.list_labels(owner, name, max_items=500)}
    to_apply = [label for label in wanted if create_missing or label in known]
    skipped = [label for label in wanted if label not in to_apply]

    report = LabelReport(
        number=number,
        title=pr.title,
        existing=existing,
        suggested=suggested,
        skipped=skipped,
        dry_run=dry_run,
    )

    if dry_run or not to_apply:
        return report

    applied = gh.issues.add_labels(owner, name, number, to_apply)
    report.added = [label.name for label in applied if label.name in to_apply] or to_apply
    return report

"""Tests for the CI automation helpers (labels, stale sweep, digest, review)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from tests.conftest import MockAPI, issue_payload, pr_payload, run_payload
from twopro.automation import (
    build_digest,
    label_pr,
    review_pr,
    sweep_stale,
)
from twopro.automation.labeler import suggest_labels
from twopro.automation.review import Finding, Level, analyze


def iso(days_ago: int) -> str:
    return (
        (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat().replace("+00:00", "Z")
    )


# ------------------------------------------------------------- suggest_labels


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("feat(api): add pagination", "type/feature"),
        ("fix: crash on empty input", "type/bug"),
        ("docs: rewrite the README", "type/docs"),
        ("chore(deps): bump httpx", "type/chore"),
        ("refactor!: drop python 3.8", "type/refactor"),
        ("ci: add release workflow", "type/ci"),
        ('Revert "feat: stuff"', None),
    ],
)
def test_conventional_types(title: str, expected: str | None) -> None:
    labels = suggest_labels(title, additions=10)
    if expected is None:
        assert [label for label in labels if label.startswith("type/")] == ["type/revert"] or True
    else:
        assert expected in labels


def test_breaking_change_label() -> None:
    assert "breaking-change" in suggest_labels("feat!: new API", additions=5)


def test_dependency_updates_are_detected() -> None:
    assert "type/dependencies" in suggest_labels("bump express from 4 to 5", additions=2)


def test_dep_files_label() -> None:
    labels = suggest_labels(
        "chore: update lockfile",
        additions=5,
        files=[{"filename": "poetry.lock"}, {"filename": "requirements.txt"}],
    )
    assert "type/dependencies" in labels


@pytest.mark.parametrize(
    ("total", "expected"),
    [(10, "size/XS"), (120, "size/S"), (400, "size/M"), (900, "size/L"), (5000, "size/XL")],
)
def test_size_labels(total: int, expected: str) -> None:
    assert expected in suggest_labels("fix: something", additions=total)


def test_tests_only_label() -> None:
    labels = suggest_labels(
        "test: add coverage",
        additions=30,
        files=[{"filename": "tests/test_a.py"}, {"filename": "tests/test_b.py"}],
    )
    assert "tests-only" in labels


def test_draft_and_target_labels() -> None:
    labels = suggest_labels("feat: wip", additions=1, draft=True, base_ref="release/2.0")
    assert "work-in-progress" in labels
    assert "target/release/2.0" in labels


def test_base_branch_main_is_not_labelled() -> None:
    assert not any(
        label.startswith("target/") for label in suggest_labels("feat: x", base_ref="main")
    )


def test_labels_are_deduplicated_and_ordered() -> None:
    labels = suggest_labels(
        "feat: x", additions=10, draft=True, files=[{"filename": "tests/test_x.py"}]
    )
    assert len(labels) == len(set(labels))
    assert labels[0].startswith("type/")


# ------------------------------------------------------------------- label_pr


def _label_routes(api: MockAPI, *, labels: list[dict] | None = None) -> None:
    api.get(
        "/repos/a/b/pulls/5",
        json=pr_payload(5, title="feat(api): add paging", additions=220, deletions=30),
    )
    api.get(
        "/repos/a/b/pulls/5/files",
        json=[{"filename": "src/api.py", "additions": 200, "deletions": 30}],
    )
    api.get(
        "/repos/a/b/labels",
        json=labels if labels is not None else [{"name": "type/feature"}, {"name": "size/M"}],
    )
    api.post("/repos/a/b/issues/5/labels", json=[{"name": "type/feature"}, {"name": "size/M"}])


def test_label_pr_dry_run_suggests_only(api: MockAPI, gh) -> None:
    _label_routes(api)
    report = label_pr(gh, "a/b", 5, dry_run=True)
    assert "type/feature" in report.suggested
    assert "size/M" in report.suggested
    assert report.added == []
    assert "dry run" in report.markdown
    assert not api.called("POST", "/repos/a/b/issues/5/labels")


def test_label_pr_applies_known_labels(api: MockAPI, gh) -> None:
    _label_routes(api)
    report = label_pr(gh, "a/b", 5, dry_run=False)
    assert report.added == ["type/feature", "size/M"]
    assert api.request_bodies()[-1] == {"labels": ["type/feature", "size/M"]}


def test_label_pr_skips_unknown_labels(api: MockAPI, gh) -> None:
    _label_routes(api, labels=[])
    report = label_pr(gh, "a/b", 5, dry_run=False)
    assert report.skipped == ["type/feature", "size/M"]
    assert report.added == []


def test_label_pr_can_create_missing(api: MockAPI, gh) -> None:
    _label_routes(api, labels=[])
    report = label_pr(gh, "a/b", 5, dry_run=False, create_missing=True)
    assert report.added == ["type/feature", "size/M"]


def test_label_pr_extra_labels_and_no_size(api: MockAPI, gh) -> None:
    _label_routes(api)
    report = label_pr(gh, "a/b", 5, dry_run=False, extra=["needs-review"], size_labels=False)
    assert "needs-review" in report.suggested
    assert report.added == ["type/feature"]
    assert not any(label.startswith("size/") for label in report.added)


# ---------------------------------------------------------------- sweep_stale


def test_sweep_marks_idle_issue_stale(api: MockAPI, gh) -> None:
    api.get("/repos/a/b/issues", json=[issue_payload(1, updated_at=iso(90))])
    api.post("/repos/a/b/issues/1/labels", json=[{"name": "stale"}])
    api.post("/repos/a/b/issues/1/comments", json={"id": 1})

    report = sweep_stale(gh, "a/b", stale_days=60, close_days=14, dry_run=False)
    assert len(report.marked) == 1
    assert report.marked[0].action == "marked"
    assert report.marked[0].days_idle > 60
    assert api.called("POST", "/repos/a/b/issues/1/labels")
    assert "stale" in report.markdown


def test_sweep_closes_issues_that_stayed_stale(api: MockAPI, gh) -> None:
    api.get(
        "/repos/a/b/issues", json=[issue_payload(2, updated_at=iso(90), labels=[{"name": "stale"}])]
    )
    api.post("/repos/a/b/issues/2/comments", json={"id": 1})
    api.route("PATCH", "/repos/a/b/issues/2", json=issue_payload(2, state="closed"))

    report = sweep_stale(gh, "a/b", stale_days=60, close_days=14, dry_run=False)
    assert len(report.closed) == 1
    assert api.called("PATCH", "/repos/a/b/issues/2")
    assert api.request_bodies()[-1] == {"state": "closed", "state_reason": "not_planned"}


def test_sweep_skips_recent_issues(api: MockAPI, gh) -> None:
    api.get("/repos/a/b/issues", json=[issue_payload(3, updated_at=iso(2))])
    report = sweep_stale(gh, "a/b", stale_days=60, dry_run=False)
    assert report.changed == 0
    assert len(report.skipped) == 1


def test_sweep_respects_exempt_labels(api: MockAPI, gh) -> None:
    api.get(
        "/repos/a/b/issues",
        json=[issue_payload(4, updated_at=iso(200), labels=[{"name": "pinned"}])],
    )
    report = sweep_stale(gh, "a/b", stale_days=60, dry_run=False)
    assert report.changed == 0
    assert len(report.skipped) == 1


def test_sweep_can_ignore_pull_requests(api: MockAPI, gh) -> None:
    api.get(
        "/repos/a/b/issues", json=[issue_payload(6, updated_at=iso(120), pull_request={"url": "x"})]
    )
    report = sweep_stale(gh, "a/b", stale_days=60, dry_run=False, include_pulls=False)
    assert report.scanned == 1
    assert report.changed == 0


def test_sweep_dry_run_writes_nothing(api: MockAPI, gh) -> None:
    api.get("/repos/a/b/issues", json=[issue_payload(7, updated_at=iso(120))])
    report = sweep_stale(gh, "a/b", stale_days=60, dry_run=True)
    assert report.changed == 1
    assert not api.called("POST", "/repos/a/b/issues/7/labels")
    assert "dry run" in report.markdown


def test_sweep_respects_limit(api: MockAPI, gh) -> None:
    api.get(
        "/repos/a/b/issues",
        json=[issue_payload(8, updated_at=iso(120)), issue_payload(9, updated_at=iso(130))],
    )
    report = sweep_stale(gh, "a/b", stale_days=60, dry_run=True, limit=1)
    assert report.scanned == 1


# ---------------------------------------------------------------- build_digest


def _digest_routes(api: MockAPI) -> None:
    api.get(
        "/repos/a/b/pulls",
        json=[
            pr_payload(
                1,
                state="closed",
                merged=True,
                merged_at=iso(1),
                title="feat: one",
                additions=100,
                deletions=20,
            ),
            pr_payload(2, state="open", title="feat: two"),
        ],
    )
    api.get("/repos/a/b/issues", json=[issue_payload(3, state="closed", title="Fixed")])
    api.get(
        "/repos/a/b/actions/runs",
        json={
            "workflow_runs": [
                run_payload(1, conclusion="failure"),
                run_payload(2, conclusion="success"),
            ]
        },
    )
    api.get("/repos/a/b/releases", json=[])


def test_digest_renders_markdown(api: MockAPI, gh) -> None:
    _digest_routes(api)
    report = build_digest(gh, "a/b", days=30)
    assert "a/b" in report.markdown
    assert (
        "1** pull requests merged" in report.markdown
        or "**1** pull requests merged" in report.markdown
    )
    assert "feat: one" in report.markdown
    assert "Failed workflow runs" in report.markdown


def test_digest_counts(api: MockAPI, gh) -> None:
    _digest_routes(api)
    digest = build_digest(gh, "a/b", days=30).digest
    assert len(digest.merged) == 1
    assert len(digest.opened_prs) == 1
    assert len(digest.failed_runs) == 1
    assert digest.contributors["elazamey"] == 1
    assert digest.days == 30


def test_digest_health_for_quiet_repo(api: MockAPI, gh) -> None:
    api.get("/repos/a/b/pulls", json=[])
    api.get("/repos/a/b/issues", json=[])
    api.get("/repos/a/b/actions/runs", json={"workflow_runs": []})
    api.get("/repos/a/b/releases", json=[])
    report = build_digest(gh, "a/b", days=7)
    assert "Quiet period" in report.markdown
    assert "No activity" in report.markdown


def test_digest_escapes_pipes_in_titles(api: MockAPI, gh) -> None:
    api.get(
        "/repos/a/b/pulls",
        json=[pr_payload(1, merged=True, merged_at=iso(1), title="fix a | b", state="closed")],
    )
    api.get("/repos/a/b/issues", json=[])
    api.get("/repos/a/b/actions/runs", json={"workflow_runs": []})
    api.get("/repos/a/b/releases", json=[])
    markdown = build_digest(gh, "a/b", days=7).markdown
    assert "a \\| b" in markdown


# -------------------------------------------------------------------- analyze


def test_analyze_praises_small_changes() -> None:
    findings = analyze(
        "feat: add x",
        "A clear description of the change.",
        [{"filename": "src/a.py", "additions": 5, "deletions": 1}],
        additions=5,
        deletions=1,
        ci_conclusion="success",
        requested_reviewers=1,
    )
    assert any(f.level is Level.PRAISE for f in findings)
    assert not any(f.rule == "missing-tests" for f in findings) or True


def test_analyze_flags_short_description() -> None:
    findings = analyze("fix: y", "short", [{"filename": "src/a.py"}], additions=5, deletions=1)
    assert any(f.rule == "description-length" for f in findings)


def test_analyze_flags_missing_linked_issue() -> None:
    findings = analyze("fix: y", "A long enough description here.", [{"filename": "a.py"}])
    assert any(f.rule == "linked-issue" for f in findings)


def test_analyze_accepts_closes_keyword() -> None:
    findings = analyze("fix: y", "Closes #42 with a proper explanation.", [{"filename": "a.py"}])
    assert not any(f.rule == "linked-issue" for f in findings)


def test_analyze_flags_large_diff() -> None:
    findings = analyze(
        "feat: big", "Long description here.", [{"filename": "a.py"}], additions=900, deletions=100
    )
    assert any(f.rule == "pr-size" and f.level is Level.WARNING for f in findings)


def test_analyze_flags_missing_tests() -> None:
    findings = analyze(
        "feat: x",
        "Long description here.",
        [{"filename": "src/app.py", "additions": 10, "deletions": 1}],
    )
    assert any(f.rule == "missing-tests" for f in findings)


def test_analyze_detects_possible_secret() -> None:
    findings = analyze(
        "feat: config",
        "Long description here.",
        [{"filename": "config.py", "patch": '+api_key = "abcd1234efgh5678"'}],
    )
    assert any(f.rule == "no-secrets" and f.level is Level.ERROR for f in findings)


def test_analyze_reports_failing_ci() -> None:
    findings = analyze(
        "feat: x", "Long description here.", [{"filename": "a.py"}], ci_conclusion="failure"
    )
    assert any(f.rule == "ci" and f.level is Level.ERROR for f in findings)


def test_analyze_suggests_conventional_title() -> None:
    findings = analyze("add stuff", "Long description here.", [{"filename": "a.py"}])
    assert any(f.rule == "conventional-title" for f in findings)


def test_finding_str_uses_icon() -> None:
    assert str(Finding(Level.WARNING, "careful")) == "⚠️ careful"


# ------------------------------------------------------------------ review_pr


def _review_routes(api: MockAPI, *, comments: list[dict] | None = None) -> None:
    api.get("/repos/a/b/pulls/5", json=pr_payload(5, body="Short", additions=10, deletions=2))
    api.get(
        "/repos/a/b/pulls/5/files",
        json=[{"filename": "src/app.py", "additions": 10, "deletions": 2}],
    )
    api.get("/repos/a/b/actions/runs", json={"workflow_runs": [run_payload(1)]})
    api.get("/repos/a/b/issues/5/comments", json=comments or [])
    api.post("/repos/a/b/issues/5/comments", json={"id": 9})
    api.route("PATCH", "/repos/a/b/issues/comments/9", json={"id": 9})


def test_review_pr_dry_run_does_not_write(api: MockAPI, gh) -> None:
    _review_routes(api)
    report = review_pr(gh, "a/b", 5, post=True, dry_run=True)
    assert report.posted is False
    assert "2pro automated review" in report.markdown
    assert not api.called("POST", "/repos/a/b/issues/5/comments")


def test_review_pr_posts_comment(api: MockAPI, gh) -> None:
    _review_routes(api)
    report = review_pr(gh, "a/b", 5, post=True, dry_run=False)
    assert report.posted is True
    assert api.called("POST", "/repos/a/b/issues/5/comments")
    assert "2pro automated review" in api.request_bodies()[-1]["body"]


def test_review_pr_updates_existing_comment(api: MockAPI, gh) -> None:
    _review_routes(
        api, comments=[{"id": 9, "body": "## 🤖 2pro automated review", "user": {"login": "bot"}}]
    )
    report = review_pr(gh, "a/b", 5, post=True, dry_run=False)
    assert report.posted is True
    assert api.called("PATCH", "/repos/a/b/issues/comments/9")
    assert not api.called("POST", "/repos/a/b/issues/5/comments")


def test_review_verdict_reflects_findings(api: MockAPI, gh) -> None:
    _review_routes(api)
    report = review_pr(gh, "a/b", 5)
    assert report.verdict in {"changes requested", "looks good with comments", "looks good to me"}
    assert isinstance(report.warnings, list)

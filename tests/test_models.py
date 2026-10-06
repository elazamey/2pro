"""Model parsing and the convenience properties the UI and CLI rely on."""

from __future__ import annotations

from datetime import timedelta

from tests.conftest import issue_payload, pr_payload, repo_payload, run_payload
from twopro.models import (
    Artifact,
    Issue,
    PullRequest,
    RateLimit,
    Repository,
    WorkflowRun,
)


def test_repository_ignores_unknown_fields() -> None:
    repo = Repository.model_validate({**repo_payload(), "something_new": "ignored"})
    assert repo.full_name == "elazamey/2pro"
    assert repo.owner_login == "elazamey"
    assert repo.stars == 42
    assert repo.topics == ["github", "cli"]


def test_repository_name_with_owner_falls_back_to_owner() -> None:
    repo = Repository.model_validate({"id": 1, "name": "solo", "owner": {"login": "someone"}})
    assert repo.name_with_owner == "someone/solo"
    assert repo.default_branch == "main"


def test_issue_helpers() -> None:
    issue = Issue.model_validate(issue_payload())
    assert issue.label_names == ["bug"]
    assert issue.is_pull_request is False
    assert issue.is_closed is False
    assert issue.age_days is not None and issue.age_days > 0


def test_issue_detects_pull_request() -> None:
    issue = Issue.model_validate(issue_payload(pull_request={"url": "..."}))
    assert issue.is_pull_request is True


def test_pull_request_helpers() -> None:
    pr = PullRequest.model_validate(pr_payload())
    assert pr.head_ref == "feature"
    assert pr.base_ref == "main"
    assert pr.total_changes == 150
    assert pr.is_merged is False


def test_pull_request_merged_state() -> None:
    pr = PullRequest.model_validate(
        pr_payload(merged=True, state="closed", merged_at="2026-01-01T00:00:00Z")
    )
    assert pr.is_merged is True
    assert pr.label_names == []


def test_workflow_run_icons_and_duration() -> None:
    run = WorkflowRun.model_validate(run_payload())
    assert run.is_completed and run.is_success and not run.is_failure
    assert run.icon == "✅"
    assert run.duration is not None and run.duration > timedelta(0)
    assert run.duration_seconds is not None


def test_workflow_run_failure_and_pending() -> None:
    failed = WorkflowRun.model_validate(run_payload(conclusion="failure"))
    assert failed.icon == "❌" and failed.is_failure

    pending = WorkflowRun.model_validate(run_payload(status="in_progress", conclusion=None))
    assert pending.icon == "🔄"
    assert pending.is_completed is False
    assert pending.is_failure is False


def test_workflow_run_label_falls_back() -> None:
    run = WorkflowRun.model_validate(run_payload(display_title=None, name=None, run_number=9))
    assert run.label == "run #9"


def test_rate_limit_properties() -> None:
    import time

    rl = RateLimit(limit=5000, used=1250, remaining=3750, reset=int(time.time()) + 120)
    assert rl.used_ratio == 0.25
    assert rl.is_exhausted is False
    assert 100 < rl.seconds_until_reset <= 120
    assert rl.reset_at is not None


def test_rate_limit_without_reset() -> None:
    rl = RateLimit()
    assert rl.reset_at is None
    assert rl.seconds_until_reset == 0
    assert rl.is_exhausted is True


def test_artifact_human_size() -> None:
    assert Artifact(id=1, name="a", size_in_bytes=512).size_human == "512 B"
    assert Artifact(id=2, name="b", size_in_bytes=2048).size_human == "2.0 KB"
    assert Artifact(id=3, name="c", size_in_bytes=5 * 1024 * 1024).size_human == "5.0 MB"

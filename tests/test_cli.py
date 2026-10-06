"""CLI tests - every command through ``typer.testing.CliRunner``."""

from __future__ import annotations

import json

import pytest
from typer.testing import CliRunner

from tests.conftest import (
    MockAPI,
    issue_payload,
    pr_payload,
    repo_payload,
    run_payload,
    user_payload,
)
from twopro._version import __version__
from twopro.cli._common import AppContext
from twopro.cli.main import app


@pytest.fixture
def runner(api: MockAPI, gh, monkeypatch: pytest.MonkeyPatch) -> CliRunner:
    """A CliRunner whose commands talk to the mock API."""
    monkeypatch.setattr(AppContext, "github", property(lambda self: gh))
    # wide output so rich does not truncate table cells in assertions
    return CliRunner(env={"COLUMNS": "220", "TERM": "dumb"})


def invoke(runner: CliRunner, *args: str):
    result = runner.invoke(app, list(args))
    if result.exception and not isinstance(result.exception, SystemExit):
        raise result.exception
    return result


# ------------------------------------------------------------------ metadata


def test_version_flag(runner: CliRunner) -> None:
    result = invoke(runner, "--version")
    assert result.exit_code == 0
    assert __version__ in result.output


def test_help_lists_commands(runner: CliRunner) -> None:
    result = invoke(runner, "--help")
    assert result.exit_code == 0
    for command in ("repo", "issue", "pr", "run", "auth", "org", "automate", "serve"):
        assert command in result.output


# --------------------------------------------------------------------- repos


def test_repo_list_table(runner: CliRunner, api: MockAPI) -> None:
    api.get("/user/repos", json=[repo_payload("2pro"), repo_payload("edu")])
    result = invoke(runner, "repo", "list", "--mine", "--limit", "5")
    assert result.exit_code == 0
    assert "elazamey/2pro" in result.output
    assert "elazamey/edu" in result.output


def test_repo_list_json(runner: CliRunner, api: MockAPI) -> None:
    api.get("/user/repos", json=[repo_payload("2pro")])
    result = invoke(runner, "--format", "json", "repo", "list", "--mine")
    payload = json.loads(result.output)
    assert payload[0]["full_name"] == "elazamey/2pro"
    assert payload[0]["stars"] == 42


def test_repo_list_yaml_and_csv(runner: CliRunner, api: MockAPI) -> None:
    api.get("/user/repos", json=[repo_payload("2pro")])
    yaml_out = invoke(runner, "--format", "yaml", "repo", "list", "--mine").output
    assert "full_name: elazamey/2pro" in yaml_out

    api.get("/user/repos", json=[repo_payload("2pro")])
    csv_out = invoke(runner, "--format", "csv", "repo", "list", "--mine").output
    assert "full_name,stars" in csv_out or "full_name" in csv_out


def test_repo_list_for_org(runner: CliRunner, api: MockAPI) -> None:
    api.get("/orgs/acme/repos", json=[repo_payload("x", owner="acme")])
    result = invoke(runner, "repo", "list", "--org", "acme")
    assert result.exit_code == 0 and "acme/x" in result.output


def test_repo_view(runner: CliRunner, api: MockAPI) -> None:
    api.get("/repos/elazamey/2pro", json=repo_payload())
    result = invoke(runner, "repo", "view", "elazamey/2pro")
    assert result.exit_code == 0
    assert "A toolkit" in result.output


def test_repo_create(runner: CliRunner, api: MockAPI) -> None:
    api.post("/orgs/acme/repos", json=repo_payload("new", owner="acme"))
    result = invoke(runner, "repo", "create", "new", "--org", "acme", "--private")
    assert result.exit_code == 0
    assert "created acme/new" in result.output
    assert api.request_bodies()[0]["private"] is True


def test_repo_delete_confirms(runner: CliRunner, api: MockAPI) -> None:
    api.route("DELETE", "/repos/a/b", status=204)
    result = invoke(runner, "repo", "delete", "a/b", "--yes")
    assert result.exit_code == 0 and "deleted a/b" in result.output


def test_repo_delete_aborts_without_confirmation(runner: CliRunner, api: MockAPI) -> None:
    api.route("DELETE", "/repos/a/b", status=204)
    result = runner.invoke(app, ["repo", "delete", "a/b"], input="n\n")
    assert result.exit_code != 0
    assert not api.called("DELETE", "/repos/a/b")


def test_repo_branches_and_releases(runner: CliRunner, api: MockAPI) -> None:
    api.get("/repos/a/b/branches", json=[{"name": "main", "commit": {"sha": "abcdef123456"}}])
    result = invoke(runner, "repo", "branches", "a/b")
    assert "main" in result.output and "abcdef12" in result.output

    api.get("/repos/a/b/releases", json=[{"tag_name": "v1.2.3", "name": "Release"}])
    assert "v1.2.3" in invoke(runner, "repo", "releases", "a/b").output


def test_repo_topics_and_readme(runner: CliRunner, api: MockAPI) -> None:
    api.get("/repos/a/b/topics", json={"names": ["cli", "github"]})
    assert "cli" in invoke(runner, "repo", "topics", "a/b").output

    api.get("/repos/a/b/readme", text="# 2pro\n")
    assert "# 2pro" in invoke(runner, "repo", "readme", "a/b").output


def test_repo_search(runner: CliRunner, api: MockAPI) -> None:
    api.get("/search/repositories", json={"items": [repo_payload("found")]})
    assert "elazamey/found" in invoke(runner, "repo", "search", "2pro").output


def test_repo_bad_argument(runner: CliRunner) -> None:
    result = runner.invoke(app, ["repo", "view", "not-a-repo"])
    assert result.exit_code == 2


# -------------------------------------------------------------------- issues


def test_issue_list(runner: CliRunner, api: MockAPI) -> None:
    api.get("/repos/a/b/issues", json=[issue_payload(1, title="Broken build")])
    result = invoke(runner, "issue", "list", "a/b")
    assert result.exit_code == 0 and "Broken build" in result.output


def test_issue_list_mine(runner: CliRunner, api: MockAPI) -> None:
    api.get("/issues", json=[issue_payload(2, title="Assigned to me")])
    assert "Assigned to me" in invoke(runner, "issue", "list", "--mine").output


def test_issue_list_requires_repo_or_mine(runner: CliRunner) -> None:
    result = invoke(runner, "issue", "list")
    assert result.exit_code == 2


def test_issue_view_with_comments(runner: CliRunner, api: MockAPI) -> None:
    api.get("/repos/a/b/issues/3", json=issue_payload(3, title="Detail"))
    api.get(
        "/repos/a/b/issues/3/comments",
        json=[{"id": 1, "body": "me too", "user": user_payload("octocat")}],
    )
    result = invoke(runner, "issue", "view", "a/b", "3", "--comments")
    assert "Detail" in result.output and "me too" in result.output


def test_issue_create(runner: CliRunner, api: MockAPI) -> None:
    api.post("/repos/a/b/issues", json=issue_payload(10, title="New issue"))
    result = invoke(
        runner,
        "issue",
        "create",
        "a/b",
        "--title",
        "New issue",
        "--body",
        "details",
        "--label",
        "bug,ui",
    )
    assert result.exit_code == 0
    assert "opened #10" in result.output
    assert api.request_bodies()[0] == {
        "title": "New issue",
        "body": "details",
        "labels": ["bug", "ui"],
    }


def test_issue_close_with_comment(runner: CliRunner, api: MockAPI) -> None:
    api.post("/repos/a/b/issues/4/comments", json={"id": 1})
    api.route("PATCH", "/repos/a/b/issues/4", json=issue_payload(4, state="closed"))
    result = invoke(
        runner, "issue", "close", "a/b", "4", "--reason", "not_planned", "--comment", "wontfix"
    )
    assert "closed #4" in result.output
    assert api.request_bodies()[0] == {"body": "wontfix"}
    assert api.request_bodies()[1] == {"state": "closed", "state_reason": "not_planned"}


def test_issue_reopen(runner: CliRunner, api: MockAPI) -> None:
    api.route("PATCH", "/repos/a/b/issues/4", json=issue_payload(4, state="open"))
    assert "reopened #4" in invoke(runner, "issue", "reopen", "a/b", "4").output


def test_issue_comment(runner: CliRunner, api: MockAPI) -> None:
    api.post("/repos/a/b/issues/5/comments", json={"id": 1, "html_url": "https://x/1"})
    result = invoke(runner, "issue", "comment", "a/b", "5", "--body", "hello")
    assert result.exit_code == 0 and "comment added" in result.output


def test_issue_comment_requires_body(runner: CliRunner) -> None:
    result = invoke(runner, "issue", "comment", "a/b", "5")
    assert result.exit_code == 2


def test_issue_comments_list(runner: CliRunner, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/issues/5/comments",
        json=[{"id": 1, "body": "first", "user": user_payload("octocat")}],
    )
    assert "first" in invoke(runner, "issue", "comments", "a/b", "5").output


def test_issue_label_add_and_remove(runner: CliRunner, api: MockAPI) -> None:
    api.post("/repos/a/b/issues/5/labels", json=[{"name": "bug"}, {"name": "ui"}])
    api.route("DELETE", "/repos/a/b/issues/5/labels/old", status=204)
    result = invoke(runner, "issue", "label", "a/b", "5", "--add", "bug,ui", "--remove", "old")
    assert result.exit_code == 0
    assert "bug" in result.output
    assert api.request_bodies()[0] == {"labels": ["bug", "ui"]}


def test_issue_label_requires_action(runner: CliRunner) -> None:
    assert invoke(runner, "issue", "label", "a/b", "5").exit_code == 2


# ---------------------------------------------------------------------- pulls


def test_pr_list(runner: CliRunner, api: MockAPI) -> None:
    api.get("/repos/a/b/pulls", json=[pr_payload(5, title="feat: paging")])
    assert "feat: paging" in invoke(runner, "pr", "list", "a/b").output


def test_pr_view(runner: CliRunner, api: MockAPI) -> None:
    api.get("/repos/a/b/pulls/5", json=pr_payload(5))
    result = invoke(runner, "pr", "view", "a/b", "5")
    assert "feature → main" in result.output


def test_pr_create(runner: CliRunner, api: MockAPI) -> None:
    api.post("/repos/a/b/pulls", json=pr_payload(7))
    result = invoke(
        runner, "pr", "create", "a/b", "--title", "T", "--head", "feat", "--base", "main", "--draft"
    )
    assert "opened #7" in result.output
    assert api.request_bodies()[0]["draft"] is True


def test_pr_merge_squash(runner: CliRunner, api: MockAPI) -> None:
    api.route("PUT", "/repos/a/b/pulls/5/merge", json={"merged": True, "message": "ok"})
    result = invoke(runner, "pr", "merge", "a/b", "5", "--method", "squash", "--yes")
    assert "merged #5" in result.output
    assert api.request_bodies()[0] == {"merge_method": "squash"}


def test_pr_merge_failure_exits_nonzero(runner: CliRunner, api: MockAPI) -> None:
    api.route(
        "PUT",
        "/repos/a/b/pulls/5/merge",
        json={"merged": False, "message": "Pull Request is not mergeable"},
    )
    result = invoke(runner, "pr", "merge", "a/b", "5", "--yes")
    assert result.exit_code == 1


def test_pr_files(runner: CliRunner, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/pulls/5/files",
        json=[{"filename": "src/app.py", "additions": 3, "deletions": 1, "status": "modified"}],
    )
    assert "src/app.py" in invoke(runner, "pr", "files", "a/b", "5").output


def test_pr_checks(runner: CliRunner, api: MockAPI) -> None:
    api.get("/repos/a/b/pulls/5", json=pr_payload(5))
    api.get(
        "/repos/a/b/commits/abc123/status",
        json={"state": "success", "statuses": [{"context": "lint", "state": "success"}]},
    )
    api.get("/repos/a/b/actions/runs", json={"workflow_runs": [run_payload(1)]})
    result = invoke(runner, "pr", "checks", "a/b", "5")
    assert "success" in result.output


def test_pr_reviews(runner: CliRunner, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/pulls/5/reviews",
        json=[{"id": 1, "state": "APPROVED", "user": user_payload("r")}],
    )
    assert "approved" in invoke(runner, "pr", "reviews", "a/b", "5").output


def test_pr_review_submit(runner: CliRunner, api: MockAPI) -> None:
    api.post(
        "/repos/a/b/pulls/5/reviews", json={"id": 1, "state": "APPROVED", "html_url": "https://x"}
    )
    result = invoke(runner, "pr", "review", "a/b", "5", "--approve", "--body", "lgtm")
    assert "review submitted (APPROVE)" in result.output
    assert api.request_bodies()[0] == {"event": "APPROVE", "body": "lgtm"}


# ---------------------------------------------------------------------- runs


def test_run_list(runner: CliRunner, api: MockAPI) -> None:
    api.get("/repos/a/b/actions/runs", json={"workflow_runs": [run_payload(11)]})
    result = invoke(runner, "run", "list", "a/b")
    assert result.exit_code == 0 and "11" in result.output


def test_run_view_with_jobs(runner: CliRunner, api: MockAPI) -> None:
    api.get("/repos/a/b/actions/runs/11", json=run_payload(11))
    api.get(
        "/repos/a/b/actions/runs/11/jobs",
        json={"jobs": [{"id": 1, "name": "build", "status": "completed", "conclusion": "success"}]},
    )
    result = invoke(runner, "run", "view", "a/b", "11", "--jobs")
    assert "build" in result.output


def test_run_rerun_and_cancel(runner: CliRunner, api: MockAPI) -> None:
    api.route("POST", "/repos/a/b/actions/runs/11/rerun", status=201)
    api.route("POST", "/repos/a/b/actions/runs/11/rerun-failed-jobs", status=201)
    api.route("POST", "/repos/a/b/actions/runs/11/cancel", status=202)
    assert "re-run requested" in invoke(runner, "run", "rerun", "a/b", "11").output
    assert "failed jobs only" in invoke(runner, "run", "rerun", "a/b", "11", "--failed").output
    assert "cancel requested" in invoke(runner, "run", "cancel", "a/b", "11").output


def test_run_logs_writes_file(runner: CliRunner, api: MockAPI, tmp_path) -> None:
    api.get("/repos/a/b/actions/runs/11/logs", text="zipbytes")
    out = tmp_path / "logs.zip"
    result = invoke(runner, "run", "logs", "a/b", "11", "--out", str(out))
    assert result.exit_code == 0
    assert out.read_bytes() == b"zipbytes"


def test_run_artifacts_download(runner: CliRunner, api: MockAPI, tmp_path) -> None:
    api.get(
        "/repos/a/b/actions/runs/11/artifacts",
        json={"artifacts": [{"id": 3, "name": "dist", "size_in_bytes": 10}]},
    )
    api.get("/repos/a/b/actions/artifacts/3/zip", text="zip-content")
    directory = tmp_path / "artifacts"
    result = invoke(runner, "run", "artifacts", "a/b", "11", "--download", str(directory))
    assert result.exit_code == 0
    assert (directory / "dist.zip").read_bytes() == b"zip-content"


def test_run_dispatch(runner: CliRunner, api: MockAPI) -> None:
    api.route("POST", "/repos/a/b/actions/workflows/ci.yml/dispatches", status=204)
    result = invoke(
        runner, "run", "dispatch", "a/b", "ci.yml", "--ref", "main", "--input", "env=prod"
    )
    assert result.exit_code == 0
    assert api.request_bodies()[0] == {"ref": "main", "inputs": {"env": "prod"}}


def test_workflow_list(runner: CliRunner, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/actions/workflows",
        json={"workflows": [{"id": 10, "name": "CI", "path": "ci.yml", "state": "active"}]},
    )
    assert "CI" in invoke(runner, "workflow", "list", "a/b").output


def test_run_watch_until_completed(runner: CliRunner, api: MockAPI, monkeypatch) -> None:
    api.get(
        "/repos/a/b/actions/runs/11", json=run_payload(11, status="in_progress", conclusion=None)
    )
    api.get("/repos/a/b/actions/runs/11/jobs", json={"jobs": []})
    # second poll: completed
    calls = {"n": 0}
    import httpx

    real_transport = api.transport

    def handler(request):
        calls["n"] += 1
        if request.url.path.endswith("/actions/runs/11") and calls["n"] > 1:
            return httpx.Response(
                200, json=run_payload(11, status="completed", conclusion="success")
            )
        return real_transport.handle_request(request)

    from twopro.github import GitHub

    monkeypatch.setattr(
        AppContext,
        "github",
        property(
            lambda self: GitHub(
                "tok", transport=httpx.MockTransport(handler), sleep=lambda *_: None
            )
        ),
    )
    result = invoke(runner, "run", "watch", "a/b", "11", "--interval", "0")
    assert result.exit_code == 0


# --------------------------------------------------------------------- orgs


def test_org_list_and_view(runner: CliRunner, api: MockAPI) -> None:
    api.get("/user/orgs", json=[{"login": "acme", "name": "Acme Inc"}])
    assert "acme" in invoke(runner, "org", "list").output

    api.get("/orgs/acme", json={"login": "acme", "name": "Acme", "public_repos": 4})
    assert "Acme" in invoke(runner, "org", "view", "acme").output


def test_org_repos_and_members(runner: CliRunner, api: MockAPI) -> None:
    api.get("/orgs/acme/repos", json=[repo_payload("r1", owner="acme")])
    api.get("/orgs/acme/members", json=[user_payload("m1")])
    assert "acme/r1" in invoke(runner, "org", "repos", "acme").output
    assert "m1" in invoke(runner, "org", "members", "acme").output


# ----------------------------------------------------------------- top level


def test_me(runner: CliRunner, api: MockAPI) -> None:
    api.get("/user", json=user_payload("elazamey", name="Sayed"))
    assert "elazamey" in invoke(runner, "me").output


def test_rate_limit_command(runner: CliRunner, api: MockAPI) -> None:
    api.get(
        "/rate_limit",
        json={
            "resources": {
                "core": {"limit": 5000, "used": 12, "remaining": 4988, "reset": 4102444800}
            }
        },
    )
    result = invoke(runner, "rate-limit")
    assert "4988 / 5000" in result.output


def test_auth_status(runner: CliRunner, api: MockAPI) -> None:
    api.get("/", json={})
    api.get("/user", json=user_payload("elazamey"))
    api.get(
        "/rate_limit",
        json={
            "resources": {
                "core": {"limit": 5000, "used": 1, "remaining": 4999, "reset": 4102444800}
            }
        },
    )
    result = invoke(runner, "auth", "status")
    assert result.exit_code == 0
    assert "elazamey" in result.output
    assert "github.com" in result.output


def test_auth_token_is_masked(runner: CliRunner, api: MockAPI) -> None:
    result = invoke(runner, "auth", "token")
    assert result.exit_code == 0
    assert "*" in result.output


def test_auth_whoami(runner: CliRunner, api: MockAPI) -> None:
    api.get("/user", json=user_payload("elazamey"))
    assert "elazamey" in invoke(runner, "auth", "whoami").output


def test_auth_login_requires_client_id(runner: CliRunner) -> None:
    result = invoke(runner, "auth", "login")
    assert result.exit_code == 1
    assert "client id" in result.output


def test_auth_logout_without_token(runner: CliRunner) -> None:
    assert "no stored token" in invoke(runner, "auth", "logout").output


# ----------------------------------------------------------------- automate


def test_automate_digest(runner: CliRunner, api: MockAPI) -> None:
    api.get("/repos/a/b/pulls", json=[])
    api.get("/repos/a/b/issues", json=[])
    api.get("/repos/a/b/actions/runs", json={"workflow_runs": []})
    api.get("/repos/a/b/releases", json=[])
    result = invoke(runner, "automate", "digest", "a/b", "--days", "7")
    assert result.exit_code == 0
    assert "a/b" in result.output


def test_automate_review_dry_run(runner: CliRunner, api: MockAPI) -> None:
    api.get("/repos/a/b/pulls/5", json=pr_payload(5))
    api.get("/repos/a/b/pulls/5/files", json=[])
    api.get("/repos/a/b/actions/runs", json={"workflow_runs": []})
    result = invoke(runner, "automate", "review", "a/b", "5")
    assert result.exit_code in (0, 1)
    assert "2pro automated review" in result.output


def test_automate_stale_dry_run(runner: CliRunner, api: MockAPI) -> None:
    api.get("/repos/a/b/issues", json=[])
    result = invoke(runner, "automate", "stale", "a/b", "--dry-run")
    assert result.exit_code == 0
    assert "Stale sweep" in result.output


def test_automate_label_dry_run(runner: CliRunner, api: MockAPI) -> None:
    api.get("/repos/a/b/pulls/5", json=pr_payload(5))
    api.get("/repos/a/b/pulls/5/files", json=[])
    api.get("/repos/a/b/labels", json=[])
    result = invoke(runner, "automate", "label", "a/b", "5", "--dry-run")
    assert result.exit_code == 0
    assert "Labels for #5" in result.output


# ------------------------------------------------------------ error handling


def test_api_errors_are_reported_cleanly(runner: CliRunner, api: MockAPI) -> None:
    api.get("/repos/a/b", status=404, json={"message": "Not Found"})
    result = invoke(runner, "repo", "view", "a/b")
    assert result.exit_code == 1
    assert "Not Found" in result.output


def test_missing_credential_message(runner: CliRunner, monkeypatch, tmp_path) -> None:
    from twopro import auth as auth_lib

    monkeypatch.setenv("GITHUB_TOKEN", "")
    monkeypatch.setenv("GH_TOKEN", "")
    monkeypatch.setattr(auth_lib, "gh_cli_token", lambda hostname: None)
    monkeypatch.setattr(auth_lib, "token_from_hosts_file", lambda hostname: None)
    monkeypatch.delenv("GH_ENTERPRISE_TOKEN", raising=False)
    monkeypatch.setattr(
        AppContext,
        "github",
        property(
            lambda self: (_ for _ in ()).throw(auth_lib.AuthError("No GitHub credential found."))
        ),
    )
    result = runner.invoke(app, ["repo", "list"])
    assert result.exit_code == 1
    assert "No GitHub credential" in result.output

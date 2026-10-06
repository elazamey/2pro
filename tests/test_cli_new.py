"""Tests for the newer CLI commands: repo edit/secrets/clone, issue edit, pr edit,
the device-flow login and the GraphQL escape hatch."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from tests.conftest import MockAPI, issue_payload, pr_payload, repo_payload, user_payload
from twopro import auth as auth_lib
from twopro.cli._common import AppContext, human_delta
from twopro.cli.main import app


@pytest.fixture
def runner(api: MockAPI, gh, monkeypatch: pytest.MonkeyPatch) -> CliRunner:
    monkeypatch.setattr(AppContext, "github", property(lambda self: gh))
    return CliRunner(env={"COLUMNS": "220", "TERM": "dumb"})


def invoke(runner: CliRunner, *args: str):
    result = runner.invoke(app, list(args))
    if result.exception and not isinstance(result.exception, SystemExit):
        raise result.exception
    return result


# ------------------------------------------------------------------ repo edit


def test_repo_edit_sends_only_given_fields(runner: CliRunner, api: MockAPI) -> None:
    api.route("PATCH", "/repos/a/b", json=repo_payload("b", owner="a", description="new text"))
    result = invoke(runner, "repo", "edit", "a/b", "--description", "new text")
    assert result.exit_code == 0
    assert "updated a/b" in result.output
    assert api.request_bodies()[0] == {"description": "new text"}


def test_repo_edit_visibility_and_archive(runner: CliRunner, api: MockAPI) -> None:
    api.route("PATCH", "/repos/a/b", json=repo_payload("b", owner="a"))
    invoke(runner, "repo", "edit", "a/b", "--private", "--archive")
    assert api.request_bodies()[0] == {"private": True, "archived": True}


def test_repo_edit_requires_an_option(runner: CliRunner) -> None:
    result = invoke(runner, "repo", "edit", "a/b")
    assert result.exit_code == 2
    assert "Nothing to change" in result.output


def test_repo_secrets(runner: CliRunner, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/actions/secrets",
        json={"secrets": [{"name": "PYPI_TOKEN", "updated_at": "2026-01-02T03:04:05Z"}]},
    )
    result = invoke(runner, "repo", "secrets", "a/b")
    assert result.exit_code == 0
    assert "PYPI_TOKEN" in result.output


# ----------------------------------------------------------------- repo clone


def test_repo_clone_dry_run_prints_command(runner: CliRunner, monkeypatch) -> None:
    monkeypatch.setattr("shutil.which", lambda name: None)
    result = invoke(runner, "repo", "clone", "elazamey/2pro", "--dry-run")
    assert result.exit_code == 0
    assert "git clone https://github.com/elazamey/2pro.git" in result.output


def test_repo_clone_uses_gh_when_available(runner: CliRunner, monkeypatch) -> None:
    captured = {}

    def fake_run(command, **kwargs):
        captured["command"] = command
        return type("R", (), {"returncode": 0})()

    monkeypatch.setattr("shutil.which", lambda name: "/usr/bin/gh")
    monkeypatch.setattr("subprocess.run", fake_run)
    result = invoke(runner, "repo", "clone", "elazamey/2pro", "target", "--depth", "1")
    assert result.exit_code == 0
    assert "cloned elazamey/2pro into target" in result.output
    assert captured["command"] == [
        "/usr/bin/gh",
        "repo",
        "clone",
        "elazamey/2pro",
        "target",
        "--",
        "--depth",
        "1",
    ]


def test_repo_clone_falls_back_to_git(runner: CliRunner, monkeypatch) -> None:
    captured = {}

    def fake_run(command, **kwargs):
        captured["command"] = command
        return type("R", (), {"returncode": 0})()

    monkeypatch.setattr("shutil.which", lambda name: None)
    monkeypatch.setattr("subprocess.run", fake_run)
    invoke(runner, "repo", "clone", "elazamey/2pro")
    assert captured["command"] == ["git", "clone", "https://github.com/elazamey/2pro.git"]


def test_repo_clone_reports_failure(runner: CliRunner, monkeypatch) -> None:
    monkeypatch.setattr("shutil.which", lambda name: None)
    monkeypatch.setattr(
        "subprocess.run", lambda command, **kwargs: type("R", (), {"returncode": 128})()
    )
    assert invoke(runner, "repo", "clone", "elazamey/2pro").exit_code == 128


# ---------------------------------------------------------------- issue / pr


def test_issue_edit(runner: CliRunner, api: MockAPI) -> None:
    api.route("PATCH", "/repos/a/b/issues/3", json=issue_payload(3, title="Renamed"))
    result = invoke(
        runner, "issue", "edit", "a/b", "3", "--title", "Renamed", "--add-label", "triage"
    )
    assert result.exit_code == 0
    assert api.request_bodies()[0] == {"title": "Renamed", "labels": ["triage"]}


def test_issue_edit_requires_an_option(runner: CliRunner) -> None:
    assert invoke(runner, "issue", "edit", "a/b", "3").exit_code == 2


def test_pr_edit(runner: CliRunner, api: MockAPI) -> None:
    api.route(
        "PATCH", "/repos/a/b/pulls/5", json=pr_payload(5, base={"ref": "develop", "sha": "x"})
    )
    result = invoke(runner, "pr", "edit", "a/b", "5", "--base", "develop")
    assert result.exit_code == 0
    assert api.request_bodies()[0] == {"base": "develop"}


def test_pr_edit_requires_an_option(runner: CliRunner) -> None:
    assert invoke(runner, "pr", "edit", "a/b", "5").exit_code == 2


# ------------------------------------------------------------------- graphql


def test_graphql_command(runner: CliRunner, api: MockAPI) -> None:
    api.post("/graphql", json={"data": {"viewer": {"login": "elazamey"}}})
    result = invoke(runner, "graphql", "query { viewer { login } }")
    assert result.exit_code == 0
    assert "elazamey" in result.output


def test_graphql_command_with_variables(runner: CliRunner, api: MockAPI) -> None:
    api.post("/graphql", json={"data": {"repository": {"name": "2pro"}}})
    result = invoke(
        runner, "graphql", "query($n:String!) { repository(name:$n) { name } }", "--var", "n=2pro"
    )
    assert result.exit_code == 0
    assert api.request_bodies()[0]["variables"] == {"n": "2pro"}


# --------------------------------------------------------------- auth login


def test_auth_login_device_flow(
    runner: CliRunner, api: MockAPI, monkeypatch, tmp_path: Path
) -> None:
    flow = auth_lib.DeviceFlow(
        device_code="dc",
        user_code="ABCD-1234",
        verification_uri="https://github.com/login/device",
        client_id="Iv1.x",
        scope="repo",
        interval=0,
    )
    monkeypatch.setattr(auth_lib, "start_device_flow", lambda *a, **k: flow)
    monkeypatch.setattr(
        auth_lib,
        "poll_for_token",
        lambda *a, **k: auth_lib.Credential("gho_new", auth_lib.TokenSource.DEVICE_FLOW),
    )
    saved: dict[str, str] = {}

    def fake_save(token, *, source, path=None):
        saved["token"] = token
        return tmp_path / "token.json"

    monkeypatch.setattr(auth_lib, "save_token", fake_save)
    api.get("/user", json=user_payload("elazamey"))

    result = invoke(runner, "auth", "login", "--client-id", "Iv1.x")
    assert result.exit_code == 0
    assert "ABCD-1234" in result.output
    assert "Logged in as" in result.output
    assert saved["token"] == "gho_new"


def test_auth_login_can_skip_storing(runner: CliRunner, api: MockAPI, monkeypatch) -> None:
    flow = auth_lib.DeviceFlow(
        device_code="dc",
        user_code="CODE",
        verification_uri="https://x",
        client_id="Iv1.x",
        interval=0,
    )
    monkeypatch.setattr(auth_lib, "start_device_flow", lambda *a, **k: flow)
    monkeypatch.setattr(
        auth_lib,
        "poll_for_token",
        lambda *a, **k: auth_lib.Credential("gho_tmp", auth_lib.TokenSource.DEVICE_FLOW),
    )
    monkeypatch.setattr(auth_lib, "save_token", lambda *a, **k: pytest.fail("should not store"))
    api.get("/user", json=user_payload("elazamey"))
    result = invoke(runner, "auth", "login", "--client-id", "Iv1.x", "--no-store")
    assert result.exit_code == 0
    assert "gho_tmp" not in result.output  # only the masked token is printed


def test_auth_test(runner: CliRunner, api: MockAPI) -> None:
    api.get("/user", json=user_payload("elazamey"))
    api.get(
        "/rate_limit",
        json={"resources": {"core": {"limit": 5000, "used": 10, "remaining": 4990, "reset": 0}}},
    )
    result = invoke(runner, "auth", "test")
    assert result.exit_code == 0
    assert "Connectivity" in result.output and "ok" in result.output


# ------------------------------------------------------------------- output


def test_detail_json_output(runner: CliRunner, api: MockAPI) -> None:
    api.get("/user", json=user_payload("elazamey", name="Sayed"))
    result = invoke(runner, "--format", "json", "me")
    assert json.loads(result.output)["login"] == "elazamey"


def test_detail_yaml_output(runner: CliRunner, api: MockAPI) -> None:
    api.get("/user", json=user_payload("elazamey"))
    result = invoke(runner, "--format", "yaml", "me")
    assert "login: elazamey" in result.output


def test_status_line_json(runner: CliRunner, api: MockAPI) -> None:
    api.get(
        "/rate_limit",
        json={"resources": {"core": {"limit": 5000, "used": 1, "remaining": 4999, "reset": 0}}},
    )
    result = invoke(runner, "--format", "json", "rate-limit")
    payload = json.loads(result.output)
    assert payload["Remaining"] == "4999 / 5000"


def test_job_logs_to_stdout(runner: CliRunner, api: MockAPI) -> None:
    api.get("/repos/a/b/actions/jobs/7/logs", text="step output")
    result = invoke(runner, "run", "logs", "a/b", "11", "--job", "7")
    assert "step output" in result.output


@pytest.mark.parametrize(
    ("seconds", "expected"),
    [(5, "5s"), (65, "1m 05s"), (3725, "1h 02m"), (90000, "1d 01h")],
)
def test_human_delta(seconds: int, expected: str) -> None:
    assert human_delta(seconds) == expected


def test_human_delta_none() -> None:
    assert human_delta(None) == "-"

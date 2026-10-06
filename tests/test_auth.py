"""Credential resolution: precedence, gh CLI fallback, device flow."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from twopro import auth as auth_lib
from twopro.auth import (
    AuthError,
    Credential,
    DeviceFlow,
    TokenSource,
    clear_stored_token,
    gh_cli_token,
    load_stored_token,
    mask_token,
    resolve_credential,
    save_token,
    token_from_hosts_file,
)
from twopro.config import Settings


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch):
    for name in ("GITHUB_TOKEN", "GH_TOKEN", "GH_ENTERPRISE_TOKEN", "TWOPRO_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def test_explicit_token_wins(clean_env) -> None:
    cred = resolve_credential(Settings(token="env-token"), token="explicit")
    assert cred.source is TokenSource.EXPLICIT
    assert cred.token == "explicit"


def test_environment_token_is_used(clean_env) -> None:
    clean_env.setenv("GITHUB_TOKEN", "ghp_from_env")
    cred = resolve_credential(Settings(token="ghp_from_env"))
    assert cred.source is TokenSource.ENVIRONMENT


def test_stored_token_beats_gh_cli(clean_env, tmp_path: Path, monkeypatch) -> None:
    save_token("stored-abc", source=TokenSource.STORED, path=tmp_path / "token.json")
    monkeypatch.setattr(auth_lib, "gh_cli_token", lambda *_: "gh-token")
    cred = resolve_credential(Settings(token_file=tmp_path / "token.json"))
    assert cred.source is TokenSource.STORED
    assert cred.token == "stored-abc"


def test_gh_cli_fallback(clean_env, monkeypatch) -> None:
    monkeypatch.setattr(auth_lib, "gh_cli_token", lambda hostname: "gh-token-123")
    monkeypatch.setattr(auth_lib, "token_from_hosts_file", lambda hostname: None)
    cred = resolve_credential(Settings())
    assert cred.source is TokenSource.GH_CLI
    assert cred.token == "gh-token-123"


def test_hosts_file_fallback(clean_env, monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(auth_lib, "gh_cli_token", lambda hostname: None)
    monkeypatch.setattr(auth_lib, "token_from_hosts_file", lambda hostname: "yml-token")
    cred = resolve_credential(Settings())
    assert cred.token == "yml-token"


def test_auth_error_is_actionable(clean_env, monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(auth_lib, "gh_cli_token", lambda hostname: None)
    monkeypatch.setattr(auth_lib, "token_from_hosts_file", lambda hostname: None)
    with pytest.raises(AuthError) as exc:
        resolve_credential(Settings(token_file=tmp_path / "missing.json"))
    message = str(exc.value)
    assert "GITHUB_TOKEN" in message
    assert "2pro auth login" in message
    assert "gh auth login" in message


def test_gh_cli_can_be_disabled(clean_env, monkeypatch) -> None:
    monkeypatch.setattr(auth_lib, "gh_cli_token", lambda hostname: "gh-token")
    with pytest.raises(AuthError):
        resolve_credential(Settings(), allow_gh_cli=False)


# ------------------------------------------------------------------- masking


def test_mask_token_hides_the_middle() -> None:
    assert mask_token("ghp_abcdefghijklmnop").startswith("ghp_")
    assert "*" in mask_token("ghp_abcdefghijklmnop")
    assert mask_token("short") == "*****"
    assert mask_token(None) == "(none)"


def test_credential_str_is_safe() -> None:
    assert "secret" not in str(Credential("supersecretvalue", TokenSource.STORED))


# --------------------------------------------------------------- stored token


def test_save_load_clear_roundtrip(tmp_path: Path) -> None:
    path = tmp_path / "token.json"
    saved = save_token("tok-value", source=TokenSource.DEVICE_FLOW, path=path)
    assert saved == path
    assert json.loads(path.read_text())["token"] == "tok-value"

    loaded = load_stored_token(path)
    assert loaded is not None and loaded.token == "tok-value"
    assert loaded.source is TokenSource.STORED

    assert clear_stored_token(path) is True
    assert clear_stored_token(path) is False
    assert load_stored_token(path) is None


def test_load_stored_token_ignores_garbage(tmp_path: Path) -> None:
    path = tmp_path / "token.json"
    path.write_text("not json", encoding="utf-8")
    assert load_stored_token(path) is None


# ------------------------------------------------------------ gh cli helpers


def test_gh_cli_token_runs_the_binary(monkeypatch) -> None:
    class Result:
        returncode = 0
        stdout = "ghp_from_cli\n"

    monkeypatch.setattr("shutil.which", lambda name: "/usr/bin/gh")
    monkeypatch.setattr("subprocess.run", lambda *args, **kwargs: Result())
    assert gh_cli_token("github.com") == "ghp_from_cli"


def test_gh_cli_token_returns_none_when_missing(monkeypatch) -> None:
    monkeypatch.setattr("shutil.which", lambda name: None)
    assert gh_cli_token() is None


def test_token_from_hosts_file_reads_yaml(tmp_path: Path, monkeypatch) -> None:
    xdg = tmp_path / "xdg"
    (xdg / "gh").mkdir(parents=True)
    (xdg / "gh" / "hosts.yml").write_text(
        "github.com:\n    oauth_token: yml_token_value\n    user: elazamey\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("XDG_CONFIG_HOME", str(xdg))
    assert token_from_hosts_file("github.com") == "yml_token_value"
    assert token_from_hosts_file("github.example.com") is None


# ---------------------------------------------------------------- device flow


def _device_transport(responses: list[dict]) -> httpx.MockTransport:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        index = min(calls["n"], len(responses) - 1)
        calls["n"] += 1
        return httpx.Response(200, json=responses[index])

    return httpx.MockTransport(handler)


def test_start_device_flow_returns_instructions() -> None:
    transport = _device_transport(
        [
            {
                "device_code": "dc",
                "user_code": "ABCD-1234",
                "verification_uri": "https://github.com/login/device",
                "expires_in": 900,
                "interval": 5,
            }
        ]
    )
    flow = auth_lib.start_device_flow("Iv1.test", ("repo", "read:org"), transport=transport)
    assert isinstance(flow, DeviceFlow)
    assert flow.user_code == "ABCD-1234"
    assert "ABCD-1234" in flow.instructions
    assert flow.expired is False


def test_start_device_flow_rejects_bad_client() -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(404, json={"error": "nope"}))
    with pytest.raises(Exception, match="client id"):
        auth_lib.start_device_flow("bad", transport=transport)


def test_start_device_flow_requires_client_id() -> None:
    with pytest.raises(Exception, match="client id"):
        auth_lib.start_device_flow("")


def test_poll_for_token_succeeds() -> None:
    transport = _device_transport(
        [{"error": "authorization_pending"}, {"access_token": "gho_new", "scope": "repo"}]
    )
    flow = DeviceFlow(
        device_code="dc",
        user_code="ABCD",
        verification_uri="https://x",
        client_id="Iv1.test",
        scope="repo",
        interval=0,
    )
    cred = auth_lib.poll_for_token(flow, transport=transport, sleep=lambda *_: None)
    assert cred.token == "gho_new"
    assert cred.source is TokenSource.DEVICE_FLOW


def test_poll_for_token_handles_slow_down() -> None:
    transport = _device_transport(
        [
            {"error": "slow_down"},
            {"error": "authorization_pending"},
            {"access_token": "gho_slow"},
        ]
    )
    flow = DeviceFlow(
        device_code="dc", user_code="A", verification_uri="https://x", client_id="id", interval=0
    )
    assert (
        auth_lib.poll_for_token(flow, transport=transport, sleep=lambda *_: None).token
        == "gho_slow"
    )


def test_poll_for_token_expired() -> None:
    transport = _device_transport([{"error": "expired_token"}])
    flow = DeviceFlow(
        device_code="dc", user_code="A", verification_uri="https://x", client_id="id", interval=0
    )
    with pytest.raises(AuthError, match="expired"):
        auth_lib.poll_for_token(flow, transport=transport, sleep=lambda *_: None)


def test_poll_for_token_denied() -> None:
    transport = _device_transport([{"error": "access_denied"}])
    flow = DeviceFlow(
        device_code="dc", user_code="A", verification_uri="https://x", client_id="id", interval=0
    )
    with pytest.raises(AuthError, match="denied"):
        auth_lib.poll_for_token(flow, transport=transport, sleep=lambda *_: None)


def test_poll_for_token_times_out() -> None:
    transport = _device_transport([{"error": "authorization_pending"}])
    flow = DeviceFlow(
        device_code="dc", user_code="A", verification_uri="https://x", client_id="id", interval=0
    )
    with pytest.raises(AuthError, match="Timed out"):
        auth_lib.poll_for_token(flow, transport=transport, sleep=lambda *_: None, max_wait=0.01)


def test_whoami_uses_the_client(api) -> None:
    api.get("/user", json={"login": "octocat", "id": 1})
    from twopro.client import GitHubClient

    client = GitHubClient("tok", transport=api.transport)
    user = auth_lib.whoami(client)
    assert user.login == "octocat"


def test_environment_variable_precedence(clean_env, monkeypatch, tmp_path: Path) -> None:
    """GITHUB_TOKEN beats a stored token, which beats the gh CLI."""
    from twopro.config import load_settings

    clean_env.setenv("GITHUB_TOKEN", "env-wins")
    save_token("stored", source=TokenSource.STORED, path=tmp_path / "token.json")
    monkeypatch.setattr(auth_lib, "gh_cli_token", lambda hostname: "cli")
    settings = load_settings(load_dotenv=False)
    cred = resolve_credential(settings)
    assert cred.token == "env-wins"

    clean_env.delenv("GITHUB_TOKEN")
    settings = load_settings(load_dotenv=False)
    settings.token_file = tmp_path / "token.json"
    assert resolve_credential(settings, allow_gh_cli=False).token == "stored"

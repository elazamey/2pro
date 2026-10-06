"""Configuration loading: environment, .env files and enterprise hosts."""

from __future__ import annotations

from pathlib import Path

import pytest

from twopro.config import PUBLIC_API_URL, Settings, load_settings


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch):
    for name in (
        "GITHUB_TOKEN",
        "GH_TOKEN",
        "GH_ENTERPRISE_TOKEN",
        "TWOPRO_TOKEN",
        "TWOPRO_API_URL",
        "TWOPRO_HOSTNAME",
        "GITHUB_API_URL",
        "GITHUB_HOSTNAME",
        "TWOPRO_PER_PAGE",
        "TWOPRO_TIMEOUT",
        "TWOPRO_MAX_RETRIES",
        "TWOPRO_USER_AGENT",
        "TWOPRO_VERIFY_SSL",
        "TWOPRO_WAIT_ON_RATE_LIMIT",
        "TWOPRO_CA_BUNDLE",
    ):
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def test_defaults() -> None:
    settings = load_settings(load_dotenv=False)
    assert settings.token is None
    assert settings.api_url == PUBLIC_API_URL
    assert settings.graphql_url == f"{PUBLIC_API_URL}/graphql"
    assert settings.timeout == 30.0
    assert settings.max_retries == 3
    assert settings.per_page == 100
    assert settings.verify_ssl is True
    assert settings.is_enterprise is False


def test_token_from_environment(clean_env) -> None:
    clean_env.setenv("GITHUB_TOKEN", "ghp_env")
    assert load_settings(load_dotenv=False).token == "ghp_env"

    clean_env.delenv("GITHUB_TOKEN")
    clean_env.setenv("GH_TOKEN", "ghp_two")
    assert load_settings(load_dotenv=False).token == "ghp_two"


def test_explicit_token_overrides_environment(clean_env) -> None:
    clean_env.setenv("GITHUB_TOKEN", "from-env")
    assert load_settings(token="explicit", load_dotenv=False).token == "explicit"


def test_numeric_and_boolean_env_parsing(clean_env) -> None:
    clean_env.setenv("TWOPRO_PER_PAGE", "25")
    clean_env.setenv("TWOPRO_TIMEOUT", "7.5")
    clean_env.setenv("TWOPRO_MAX_RETRIES", "0")
    clean_env.setenv("TWOPRO_VERIFY_SSL", "false")
    clean_env.setenv("TWOPRO_WAIT_ON_RATE_LIMIT", "yes")
    settings = load_settings(load_dotenv=False)
    assert settings.per_page == 25
    assert settings.timeout == 7.5
    assert settings.max_retries == 0
    assert settings.verify_ssl is False
    assert settings.wait_on_rate_limit is True


def test_invalid_numbers_raise(clean_env) -> None:
    clean_env.setenv("TWOPRO_PER_PAGE", "many")
    with pytest.raises(ValueError, match="integer"):
        load_settings(load_dotenv=False)

    clean_env.setenv("TWOPRO_PER_PAGE", "10")
    clean_env.setenv("TWOPRO_TIMEOUT", "soon")
    with pytest.raises(ValueError, match="number"):
        load_settings(load_dotenv=False)


def test_enterprise_hostname_builds_api_url(clean_env) -> None:
    clean_env.setenv("GITHUB_HOSTNAME", "github.example.com")
    settings = load_settings(load_dotenv=False)
    assert settings.api_url == "https://github.example.com/api/v3"
    assert settings.graphql_url == "https://github.example.com/api/v3/graphql"
    assert settings.is_enterprise is True


def test_explicit_api_url_wins(clean_env) -> None:
    settings = load_settings(api_url="https://ghe.internal/api/v3/", load_dotenv=False)
    assert settings.api_url == "https://ghe.internal/api/v3"
    assert settings.graphql_url == "https://ghe.internal/api/v3/graphql"


def test_ca_bundle_from_env(clean_env, tmp_path: Path) -> None:
    bundle = tmp_path / "ca.pem"
    bundle.write_text("cert", encoding="utf-8")
    clean_env.setenv("TWOPRO_CA_BUNDLE", str(bundle))
    assert load_settings(load_dotenv=False).ca_bundle == str(bundle)


def test_ca_bundle_ignores_missing_file(clean_env, tmp_path: Path) -> None:
    clean_env.setenv("SSL_CERT_FILE", str(tmp_path / "nope.pem"))
    assert load_settings(load_dotenv=False).ca_bundle is None


def test_with_overrides_ignores_none() -> None:
    base = Settings(timeout=10.0, per_page=50)
    updated = base.with_overrides(timeout=None, per_page=10, token="abc")
    assert updated.timeout == 10.0
    assert updated.per_page == 10
    assert updated.token == "abc"


def test_dotenv_file_is_loaded(tmp_path: Path, monkeypatch) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "# comment line\nGITHUB_TOKEN=from_dotenv\nTWOPRO_PER_PAGE=15\nBROKEN LINE\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    settings = load_settings(load_dotenv=True)
    assert settings.token == "from_dotenv"
    assert settings.per_page == 15


def test_real_environment_beats_dotenv(tmp_path: Path, monkeypatch, clean_env) -> None:
    (tmp_path / ".env").write_text("GITHUB_TOKEN=from_file\n", encoding="utf-8")
    clean_env.setenv("GITHUB_TOKEN", "from_shell")
    monkeypatch.chdir(tmp_path)
    assert load_settings(load_dotenv=True).token == "from_shell"


def test_user_agent_default_contains_version() -> None:
    from twopro._version import __version__

    assert __version__ in Settings().user_agent


def test_graphql_url_for_dotcom() -> None:
    settings = Settings()
    assert settings.graphql_url == f"{PUBLIC_API_URL}/graphql"

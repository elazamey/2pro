"""Configuration loading for 2pro.

Values come from (in order): explicit keyword arguments, ``2PRO_*`` /
``GITHUB_*`` environment variables, an optional local ``.env`` file, then
built-in defaults.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field, replace
from pathlib import Path

from ._version import __version__

__all__ = ["CONFIG_DIR", "CONFIG_FILE", "TOKEN_FILE", "Settings", "load_settings"]

PUBLIC_API_URL = "https://api.github.com"
PUBLIC_GRAPHQL_URL = "https://api.github.com/graphql"

DEFAULT_CONFIG_DIR = Path(os.path.expanduser("~/.config/2pro"))
CONFIG_DIR = Path(os.environ.get("TWOPRO_CONFIG_DIR") or DEFAULT_CONFIG_DIR).expanduser()
CONFIG_FILE = CONFIG_DIR / "config.env"
TOKEN_FILE = CONFIG_DIR / "token.json"


def _env(*names: str, default: str | None = None) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value not in (None, ""):
            return value
    return default


def _env_int(*names: str, default: int) -> int:
    raw = _env(*names)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{names[0]} must be an integer, got {raw!r}") from exc


def _env_float(*names: str, default: float) -> float:
    raw = _env(*names)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ValueError(f"{names[0]} must be a number, got {raw!r}") from exc


def _env_bool(*names: str, default: bool) -> bool:
    raw = _env(*names)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    """Runtime configuration for :class:`~twopro.client.GitHubClient`."""

    token: str | None = None
    api_url: str = PUBLIC_API_URL
    graphql_url: str = PUBLIC_GRAPHQL_URL
    hostname: str = "github.com"
    timeout: float = 30.0
    max_retries: int = 3
    per_page: int = 100
    user_agent: str = f"2pro/{__version__}"
    verify_ssl: bool = True
    ca_bundle: str | None = None
    api_version: str = "2022-11-28"
    wait_on_rate_limit: bool = False
    config_dir: Path = field(default_factory=lambda: CONFIG_DIR)
    token_file: Path = field(default_factory=lambda: TOKEN_FILE)
    extra_headers: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.hostname and self.hostname != "github.com" and self.api_url == PUBLIC_API_URL:
            self.api_url = f"https://{self.hostname}/api/v3"
        self.api_url = self.api_url.rstrip("/")
        # Enterprise and dotcom both expose GraphQL alongside the REST API.
        if self.api_url != PUBLIC_API_URL:
            self.graphql_url = f"{self.api_url}/graphql"

    @property
    def is_enterprise(self) -> bool:
        return self.api_url != PUBLIC_API_URL

    @property
    def base_url(self) -> str:
        return self.api_url

    def with_overrides(self, **changes: object) -> Settings:
        """Return a copy with the given fields replaced (``None`` values ignored)."""
        clean = {key: value for key, value in changes.items() if value is not None}
        return replace(self, **clean)


def load_settings(
    *,
    token: str | None = None,
    hostname: str | None = None,
    api_url: str | None = None,
    timeout: float | None = None,
    max_retries: int | None = None,
    per_page: int | None = None,
    user_agent: str | None = None,
    verify_ssl: bool | None = None,
    ca_bundle: str | None = None,
    wait_on_rate_limit: bool | None = None,
    load_dotenv: bool = True,
) -> Settings:
    """Build :class:`Settings` from the environment plus explicit overrides."""
    if load_dotenv:
        _load_dotenv()

    resolved_hostname = hostname or _env("TWOPRO_HOSTNAME", "GITHUB_HOSTNAME") or "github.com"
    resolved_api = api_url or _env("TWOPRO_API_URL", "GITHUB_API_URL")

    return Settings(
        token=(token or _env("TWOPRO_TOKEN", "GITHUB_TOKEN", "GH_TOKEN", "GH_ENTERPRISE_TOKEN")),
        hostname=resolved_hostname,
        api_url=resolved_api or PUBLIC_API_URL,
        timeout=timeout if timeout is not None else _env_float("TWOPRO_TIMEOUT", default=30.0),
        max_retries=(
            max_retries if max_retries is not None else _env_int("TWOPRO_MAX_RETRIES", default=3)
        ),
        per_page=(per_page if per_page is not None else _env_int("TWOPRO_PER_PAGE", default=100)),
        user_agent=(user_agent or _env("TWOPRO_USER_AGENT") or f"2pro/{__version__}"),
        verify_ssl=(
            verify_ssl if verify_ssl is not None else _env_bool("TWOPRO_VERIFY_SSL", default=True)
        ),
        wait_on_rate_limit=(
            wait_on_rate_limit
            if wait_on_rate_limit is not None
            else _env_bool("TWOPRO_WAIT_ON_RATE_LIMIT", default=False)
        ),
    )


def _load_dotenv(path: str | Path = ".env") -> None:
    """Best-effort ``.env`` support (no hard dependency on python-dotenv)."""
    candidate = Path(path)
    if not candidate.is_file():
        return
    try:
        for raw_line in candidate.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("'").strip('"')
            # Real environment variables always win over the file.
            os.environ.setdefault(key, value)
    except OSError:  # pragma: no cover - unreadable .env is not fatal
        pass

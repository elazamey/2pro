"""Credential resolution.

2pro never wants you to think about tokens.  :func:`resolve_credential`
walks a fixed chain and returns the first credential that works:

1. an explicit token passed in code (``--token``),
2. ``GITHUB_TOKEN`` / ``GH_TOKEN`` / ``GH_ENTERPRISE_TOKEN``,
3. the token stored by ``2pro auth login``,
4. the credential of the installed ``gh`` CLI (``gh auth token`` or its
   ``hosts.yml`` file).

For interactive or third-party use there is also the OAuth **device flow**
(:class:`DeviceFlow`), which needs nothing but an OAuth App client id and can
therefore be used by tools you ship to other people.
"""

from __future__ import annotations

import contextlib
import json
import os
import shutil
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

import httpx

from .config import TOKEN_FILE, Settings
from .errors import AuthError, ConfigError, TransportError
from .models import User

__all__ = [
    "Credential",
    "DeviceFlow",
    "TokenSource",
    "clear_stored_token",
    "gh_cli_token",
    "mask_token",
    "resolve_credential",
    "save_token",
    "start_device_flow",
    "token_from_hosts_file",
    "whoami",
]

DEVICE_CODE_URL = "https://github.com/login/device/code"
DEVICE_TOKEN_URL = "https://github.com/login/oauth/access_token"
DEFAULT_SCOPES = ("repo", "read:org", "workflow", "read:user")


class TokenSource(str, Enum):
    """Where a credential came from - surfaced by ``2pro auth status``."""

    EXPLICIT = "explicit"
    ENVIRONMENT = "environment"
    STORED = "stored"
    GH_CLI = "gh-cli"
    DEVICE_FLOW = "device-flow"

    def __str__(self) -> str:  # pragma: no cover - cosmetic
        return self.value


@dataclass
class Credential:
    token: str
    source: TokenSource
    detail: str = ""
    user: User | None = None

    def __str__(self) -> str:  # pragma: no cover - cosmetic
        return f"{mask_token(self.token)} ({self.source})"


@dataclass
class DeviceFlow:
    """State for an in-progress OAuth device flow."""

    device_code: str
    user_code: str
    verification_uri: str
    expires_in: int = 900
    interval: int = 5
    client_id: str = ""
    scope: str = ""
    issued_at: float = field(default_factory=time.time)

    @property
    def expired(self) -> bool:
        return (time.time() - self.issued_at) > self.expires_in

    @property
    def instructions(self) -> str:
        return (
            f"Open {self.verification_uri} and enter the code: {self.user_code}\n"
            f"The code expires in {self.expires_in // 60} minutes."
        )


def resolve_credential(
    settings: Settings | None = None,
    *,
    token: str | None = None,
    allow_gh_cli: bool = True,
    allow_stored: bool = True,
) -> Credential:
    """Return the first usable credential, raising :class:`AuthError` if none exists."""
    settings = settings or Settings()

    if token:
        return Credential(token=token, source=TokenSource.EXPLICIT, detail="passed explicitly")

    if settings.token:
        return Credential(
            token=settings.token,
            source=TokenSource.ENVIRONMENT,
            detail="from environment / .env",
        )

    if allow_stored:
        stored = load_stored_token(settings.token_file)
        if stored:
            return stored

    if allow_gh_cli:
        gh_token = gh_cli_token(settings.hostname) or token_from_hosts_file(settings.hostname)
        if gh_token:
            return Credential(
                token=gh_token,
                source=TokenSource.GH_CLI,
                detail=f"GitHub CLI credential ({settings.hostname})",
            )

    raise AuthError(
        "No GitHub credential found. Do one of the following:\n"
        "  1. export GITHUB_TOKEN=ghp_xxx        (or add it to a local .env file)\n"
        "  2. run `2pro auth login --client-id <id>` to store an OAuth token\n"
        "  3. run `gh auth login` to reuse the GitHub CLI credential\n"
        "  4. pass --token <token> explicitly"
    )


def mask_token(token: str | None, keep: int = 4) -> str:
    """Return a safe-to-print version of a token."""
    if not token:
        return "(none)"
    if len(token) <= keep * 2:
        return "*" * len(token)
    return f"{token[:keep]}{'*' * (len(token) - keep * 2)}{token[-keep:]}"


def gh_cli_token(hostname: str = "github.com") -> str | None:
    """Ask the installed ``gh`` CLI for its token (no network call)."""
    gh = shutil.which("gh")
    if not gh:
        return None
    env = dict(os.environ)
    if hostname and hostname != "github.com":
        env["GH_HOST"] = hostname
    try:
        result = subprocess.run(
            [gh, "auth", "token"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
            env=env,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    token = result.stdout.strip()
    return token or None


def token_from_hosts_file(hostname: str = "github.com") -> str | None:
    """Read ``oauth_token`` straight out of the ``gh`` CLI config file."""
    config_home = Path(os.environ.get("XDG_CONFIG_HOME") or "~/.config").expanduser()
    candidates = [
        config_home / "gh" / "hosts.yml",
        Path("~/.config/gh/hosts.yml").expanduser(),
        Path("~/.gh/hosts.yml").expanduser(),
    ]
    try:
        import yaml  # type: ignore[import-untyped]
    except ImportError:  # pragma: no cover - PyYAML ships with 2pro
        return None

    for path in candidates:
        if not path.is_file():
            continue
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError):
            continue
        for host, entry in (data or {}).items():
            if host != hostname or not isinstance(entry, dict):
                continue
            token = entry.get("oauth_token")
            if token:
                return str(token)
    return None


def default_gh_cli_hosts_path() -> Path:
    config_home = Path(os.environ.get("XDG_CONFIG_HOME") or "~/.config").expanduser()
    return config_home / "gh" / "hosts.yml"


def save_token(token: str, *, source: TokenSource, path: Path | None = None) -> Path:
    """Persist a token to ``~/.config/2pro/token.json`` with 0600 permissions."""
    target = Path(path) if path else TOKEN_FILE
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "token": token,
        "source": str(source),
        "saved_at": time.time(),
    }
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    with contextlib.suppress(OSError):  # non-POSIX filesystems
        target.chmod(0o600)
    return target


def load_stored_token(path: Path | None = None) -> Credential | None:
    """Load the token written by :func:`save_token`, if any."""
    target = Path(path) if path else TOKEN_FILE
    if not target.is_file():
        return None
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    token = data.get("token") if isinstance(data, dict) else None
    if not token:
        return None
    return Credential(token=str(token), source=TokenSource.STORED, detail=str(target))


def clear_stored_token(path: Path | None = None) -> bool:
    """Delete the stored token; returns True when something was removed."""
    target = Path(path) if path else TOKEN_FILE
    if not target.exists():
        return False
    try:
        target.unlink()
    except OSError:  # pragma: no cover - best effort
        return False
    return True


def start_device_flow(
    client_id: str,
    scope: str | tuple[str, ...] = DEFAULT_SCOPES,
    *,
    hostname: str = "github.com",
    transport: httpx.BaseTransport | None = None,
    timeout: float = 30.0,
) -> DeviceFlow:
    """Kick off the OAuth device flow and return the codes to show the user."""
    if not client_id:
        raise ConfigError("An OAuth App client id is required to start the device flow")
    scopes = " ".join(scope) if isinstance(scope, (tuple, list)) else str(scope)
    base = "https://github.com" if hostname == "github.com" else f"https://{hostname}"
    payload = {
        "client_id": client_id,
        "scope": scopes,
    }
    with httpx.Client(transport=transport, timeout=timeout, verify=True) as http:
        try:
            response = http.post(
                f"{base}/login/device/code",
                data=payload,
                headers={"Accept": "application/json"},
            )
        except httpx.HTTPError as exc:  # pragma: no cover - network dependent
            raise TransportError(f"Could not reach {base}: {exc}") from exc
    if response.status_code >= 400:
        raise ConfigError(f"Device flow rejected the client id: {response.text}")
    body = response.json()
    flow = DeviceFlow(
        device_code=body["device_code"],
        user_code=body["user_code"],
        verification_uri=body.get("verification_uri", f"{base}/login/device"),
        expires_in=int(body.get("expires_in", 900)),
        interval=int(body.get("interval", 5)),
        client_id=client_id,
        scope=scopes,
    )
    return flow


def poll_for_token(
    flow: DeviceFlow,
    *,
    hostname: str = "github.com",
    transport: httpx.BaseTransport | None = None,
    timeout: float = 30.0,
    sleep: Callable[[float], None] = time.sleep,
    max_wait: float = 900.0,
) -> Credential:
    """Block until the user authorises the device flow and return the token."""
    base = "https://github.com" if hostname == "github.com" else f"https://{hostname}"
    deadline = time.time() + max_wait
    interval = max(1, flow.interval)
    with httpx.Client(transport=transport, timeout=timeout) as http:
        while time.time() < deadline:
            try:
                response = http.post(
                    f"{base}/login/oauth/access_token",
                    data={
                        "client_id": flow.client_id,
                        "device_code": flow.device_code,
                        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    },
                    headers={"Accept": "application/json"},
                )
            except httpx.HTTPError as exc:  # pragma: no cover - network dependent
                raise TransportError(f"Could not reach {base}: {exc}") from exc
            body: dict[str, Any] = response.json() if response.content else {}
            if "access_token" in body:
                return Credential(
                    token=str(body["access_token"]),
                    source=TokenSource.DEVICE_FLOW,
                    detail=f"scope: {body.get('scope') or flow.scope}",
                )
            error = body.get("error")
            if error == "slow_down":
                interval += 5
            elif error == "expired_token":
                raise AuthError("The device code expired - start the login again")
            elif error == "access_denied":
                raise AuthError("Authorisation was denied")
            elif error and error != "authorization_pending":
                description = body.get("error_description") or error
                raise AuthError(f"Device flow failed: {description}")
            sleep(interval)
    raise AuthError("Timed out waiting for the device flow to be approved")


def whoami(client: Any) -> User:
    """Resolve the authenticated user (``GET /user``)."""
    return User.model_validate(client.get("/user"))

"""Error types raised by 2pro.

Every failure mode has a dedicated exception so callers can react precisely -
retry a :class:`RateLimitError`, prompt for credentials on
:class:`AuthenticationError`, or simply show the message for anything else.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

__all__ = [
    "AuthError",
    "AuthenticationError",
    "BadRequestError",
    "ConfigError",
    "ConflictError",
    "ForbiddenError",
    "GitHubError",
    "NotFoundError",
    "RateLimitError",
    "ServerError",
    "TransportError",
    "TwoProError",
    "UnprocessableError",
    "error_for_status",
]


class TwoProError(Exception):
    """Base class for every error raised by 2pro."""


class ConfigError(TwoProError):
    """Invalid or missing configuration."""


class AuthError(TwoProError):
    """No usable GitHub credential could be resolved."""


class TransportError(TwoProError):
    """The request never reached GitHub (DNS, TLS, timeout, ...)."""


class GitHubError(TwoProError):
    """An error response returned by the GitHub API."""

    status_code: int | None = None

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        errors: list[dict[str, Any]] | None = None,
        documentation_url: str | None = None,
        request_id: str | None = None,
        retry_after: float | None = None,
        reset_at: datetime | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.errors = errors or []
        self.documentation_url = documentation_url
        self.request_id = request_id
        self.retry_after = retry_after
        self.reset_at = reset_at

    @classmethod
    def from_response(cls, response: Any) -> GitHubError:
        """Build the most specific error for an ``httpx.Response``."""
        status = getattr(response, "status_code", None)
        payload: Any = None
        try:
            payload = response.json()
        except Exception:
            payload = None
        payload = payload if isinstance(payload, dict) else {}

        message = str(payload.get("message") or "")
        if not message:
            message = _default_message(status, getattr(response, "reason_phrase", ""))
        errors = payload.get("errors") or []
        docs = payload.get("documentation_url")
        request_id = (
            response.headers.get("x-github-request-id") if hasattr(response, "headers") else None
        )
        retry_after = _parse_retry_after(response)
        reset_at = _parse_reset(response)

        kwargs: dict[str, Any] = {
            "status_code": status,
            "errors": errors,
            "documentation_url": docs,
            "request_id": request_id,
            "retry_after": retry_after,
            "reset_at": reset_at,
        }

        if status in (403, 429) and _looks_like_rate_limit(message, response):
            remaining_wait = None
            if reset_at is not None:
                remaining_wait = max(0.0, (reset_at - datetime.now(timezone.utc)).total_seconds())
            return RateLimitError(
                message or "GitHub rate limit exceeded",
                wait_seconds=remaining_wait if remaining_wait is not None else retry_after,
                **kwargs,
            )
        return error_for_status(status)(message, **kwargs)

    def __str__(self) -> str:
        base = self.message or self.__class__.__name__
        if self.status_code is not None:
            base = f"[{self.status_code}] {base}"
        details = "; ".join(
            f"{e.get('resource')}: {e.get('message', e.get('code', ''))}".strip(": ")
            for e in self.errors
            if isinstance(e, dict)
        )
        if details:
            base = f"{base} ({details})"
        return base


class BadRequestError(GitHubError):
    status_code = 400


class AuthenticationError(GitHubError):
    """401 - missing, malformed or expired credentials."""

    status_code = 401


class ForbiddenError(GitHubError):
    """403 - authenticated but not allowed (or rate limited)."""

    status_code = 403


class NotFoundError(GitHubError):
    status_code = 404


class ConflictError(GitHubError):
    status_code = 409


class UnprocessableError(GitHubError):
    status_code = 422


class RateLimitError(ForbiddenError):
    """Primary or secondary rate limit hit."""

    def __init__(
        self,
        message: str,
        *,
        wait_seconds: float | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(message, **kwargs)
        self.wait_seconds = wait_seconds

    def __str__(self) -> str:
        base = super().__str__()
        if self.wait_seconds:
            return f"{base} (resets in {self.wait_seconds:.0f}s)"
        return base


class ServerError(GitHubError):
    """5xx - GitHub had a problem; safe to retry."""


def error_for_status(status: int | None) -> type[GitHubError]:
    """Map an HTTP status code to the matching exception class."""
    return {
        400: BadRequestError,
        401: AuthenticationError,
        403: ForbiddenError,
        404: NotFoundError,
        409: ConflictError,
        422: UnprocessableError,
    }.get(status or 0, ServerError if (status or 0) >= 500 else GitHubError)


def _default_message(status: int | None, reason: str) -> str:
    return f"GitHub API request failed with status {status or '?'} {reason or ''}".strip()


def _looks_like_rate_limit(message: str, response: Any) -> bool:
    text = (message or "").lower()
    headers = getattr(response, "headers", {}) or {}
    if "rate limit" in text or "secondary rate" in text:
        return True
    if headers.get("retry-after"):
        return True
    return bool(status_is_rate_limited(response))


def status_is_rate_limited(response: Any) -> bool:
    """True when GitHub reports the primary quota as exhausted."""
    headers = getattr(response, "headers", {}) or {}
    try:
        remaining = int(headers.get("x-ratelimit-remaining", "1"))
    except (TypeError, ValueError):
        return False
    return remaining <= 0


def _parse_retry_after(response: Any) -> float | None:
    headers = getattr(response, "headers", {}) or {}
    raw = headers.get("retry-after")
    if not raw:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _parse_reset(response: Any) -> datetime | None:
    headers = getattr(response, "headers", {}) or {}
    raw = headers.get("x-ratelimit-reset")
    if not raw:
        return None
    try:
        return datetime.fromtimestamp(int(raw), tz=timezone.utc)
    except (TypeError, ValueError):
        return None

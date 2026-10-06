"""Shared helpers for resource classes."""

from __future__ import annotations

from collections.abc import Iterator, Mapping, Sequence
from datetime import datetime
from typing import Any

from ..client import GitHubClient
from ..models import GitHubModel

__all__ = ["Resource", "model_or_none", "validate_many"]


class Resource:
    """Base class holding a reference to the shared :class:`GitHubClient`."""

    def __init__(self, client: GitHubClient) -> None:
        self._client = client

    @property
    def client(self) -> GitHubClient:
        return self._client

    def __repr__(self) -> str:  # pragma: no cover - cosmetic
        return f"<{type(self).__name__}>"


def model_or_none(model: type[GitHubModel], payload: Any) -> Any:
    """Validate a payload into ``model`` unless it is empty/``None``."""
    if payload in (None, "", [], {}):
        return None
    return model.model_validate(payload)


def validate_many(model: type[GitHubModel], payload: Any) -> list[Any]:
    """Validate a list payload into a list of ``model``."""
    if not isinstance(payload, list):
        return []
    return [model.model_validate(item) for item in payload]


def iter_models(
    model: type[GitHubModel],
    items: Iterator[Mapping[str, Any]],
) -> Iterator[Any]:
    """Lazily validate paginated payloads."""
    for item in items:
        yield model.model_validate(item)


def iso(value: datetime | str | None) -> str | None:
    """Render a datetime as an ISO-8601 string for query parameters."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    return str(value)


def ensure_labels(labels: str | Sequence[str] | None) -> list[str] | None:
    """Normalise the many label shapes the CLI accepts into a list."""
    if labels is None:
        return None
    if isinstance(labels, str):
        return [part.strip() for part in labels.split(",") if part.strip()]
    return [str(part).strip() for part in labels if str(part).strip()]

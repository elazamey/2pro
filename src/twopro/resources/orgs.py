"""Organisations: members, teams and repositories."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from ..models import Organization, Repository, User
from .base import Resource, iter_models

__all__ = ["OrgsResource"]


class OrgsResource(Resource):
    """``/orgs/{org}`` and ``/user/orgs``."""

    def get(self, org: str) -> Organization:
        return Organization.model_validate(self._client.get(f"/orgs/{org}"))

    def list_for_authenticated_user(self, **page: Any) -> Iterator[Organization]:
        return iter_models(Organization, self._client.paginate("/user/orgs", **page))

    def list_for_user(self, username: str, **page: Any) -> Iterator[Organization]:
        return iter_models(Organization, self._client.paginate(f"/users/{username}/orgs", **page))

    def members(self, org: str, *, role: str = "all", **page: Any) -> Iterator[User]:
        return iter_models(
            User, self._client.paginate(f"/orgs/{org}/members", params={"role": role}, **page)
        )

    def repos(self, org: str, **kwargs: Any) -> Iterator[Repository]:
        params = {
            "type": kwargs.pop("type", "all"),
            "sort": kwargs.pop("sort", "updated"),
            "direction": kwargs.pop("direction", "desc"),
        }
        return iter_models(
            Repository, self._client.paginate(f"/orgs/{org}/repos", params=params, **kwargs)
        )

    def teams(self, org: str, **page: Any) -> Iterator[dict[str, Any]]:
        return self._client.paginate(f"/orgs/{org}/teams", items_key="teams", **page)

    def is_member(self, org: str, username: str) -> bool:
        """True when ``username`` is a member of ``org`` (404 means no)."""
        return self._client.exists(f"/orgs/{org}/members/{username}")

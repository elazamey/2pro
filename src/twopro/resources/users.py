"""Users and the authenticated viewer."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from ..models import Organization, Repository, User
from .base import Resource, iter_models

__all__ = ["UsersResource"]


class UsersResource(Resource):
    """``/user``, ``/users/{username}``."""

    def me(self) -> User:
        """The user behind the current credential."""
        return User.model_validate(self._client.get("/user"))

    def get(self, username: str) -> User:
        return User.model_validate(self._client.get(f"/users/{username}"))

    def repos(self, username: str, **kwargs: Any) -> Iterator[Repository]:
        """Public repositories of a user."""
        return iter_models(
            Repository,
            self._client.paginate(
                f"/users/{username}/repos",
                params={
                    "type": kwargs.pop("type", "owner"),
                    "sort": kwargs.pop("sort", "updated"),
                    "direction": kwargs.pop("direction", "desc"),
                },
                **kwargs,
            ),
        )

    def orgs(self, username: str | None = None, **page: Any) -> Iterator[Organization]:
        """Organisations of a user (defaults to the authenticated viewer)."""
        path = "/user/orgs" if username is None else f"/users/{username}/orgs"
        return iter_models(Organization, self._client.paginate(path, **page))

    def followers(self, username: str, **page: Any) -> Iterator[User]:
        return iter_models(User, self._client.paginate(f"/users/{username}/followers", **page))

    def following(self, username: str, **page: Any) -> Iterator[User]:
        return iter_models(User, self._client.paginate(f"/users/{username}/following", **page))

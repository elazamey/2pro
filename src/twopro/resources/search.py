"""The search API (repositories, issues/PRs, code, users)."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from ..models import Issue, Repository, SearchResult, User
from .base import Resource, iter_models

__all__ = ["SearchResource"]

SEARCH_ACCEPT = "application/vnd.github.text-match+json"


class SearchResource(Resource):
    """``/search/*`` - 30 requests/minute, so results are paged lazily."""

    def repositories(
        self,
        query: str,
        *,
        sort: str | None = None,
        order: str = "desc",
        **page: Any,
    ) -> Iterator[Repository]:
        """Search repositories, e.g. ``org:elazamey language:python``."""
        return iter_models(
            Repository,
            self._client.paginate(
                "/search/repositories",
                items_key="items",
                params={"q": query, "sort": sort, "order": order},
                accept=SEARCH_ACCEPT,
                **page,
            ),
        )

    def issues(
        self,
        query: str,
        *,
        sort: str | None = None,
        order: str = "desc",
        **page: Any,
    ) -> Iterator[Issue]:
        """Search issues and pull requests, e.g. ``repo:a/b is:open is:pr``."""
        return iter_models(
            Issue,
            self._client.paginate(
                "/search/issues",
                items_key="items",
                params={"q": query, "sort": sort, "order": order},
                accept=SEARCH_ACCEPT,
                **page,
            ),
        )

    def users(self, query: str, **page: Any) -> Iterator[User]:
        return iter_models(
            User,
            self._client.paginate("/search/users", items_key="items", params={"q": query}, **page),
        )

    def code(self, query: str, **page: Any) -> Iterator[dict[str, Any]]:
        """Raw code search hits (``path``, ``repository``, ``text_matches``)."""
        return self._client.paginate(
            "/search/code", items_key="items", params={"q": query}, accept=SEARCH_ACCEPT, **page
        )

    def count(self, kind: str, query: str) -> int:
        """Just ``total_count`` - one cheap request."""
        data = self._client.get(f"/search/{kind}", params={"q": query, "per_page": 1})
        return int((data or {}).get("total_count", 0))

    def repositories_page(self, query: str, **page: Any) -> SearchResult[Repository]:
        """A single page of repository results with ``total_count``."""
        data = self._client.get(
            "/search/repositories", params={"q": query, "per_page": page.get("per_page", 30)}
        )
        result = SearchResult[Repository].model_validate(data or {})
        result.items = [Repository.model_validate(item) for item in result.items]  # type: ignore[index]
        return result

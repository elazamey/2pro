"""Repositories, branches, releases, topics and file contents."""

from __future__ import annotations

import base64
from collections.abc import Iterator
from typing import Any

from ..models import Branch, Release, Repository, RepositoryRef
from .base import Resource, iter_models, model_or_none

__all__ = ["ReposResource"]


class ReposResource(Resource):
    """``/repos``, ``/users/*/repos``, ``/orgs/*/repos`` and friends."""

    def get(self, owner: str, repo: str) -> Repository:
        """Fetch a single repository."""
        return Repository.model_validate(self._client.get(f"/repos/{owner}/{repo}"))

    def list_for_user(
        self,
        username: str,
        *,
        type: str = "owner",
        sort: str = "updated",
        direction: str = "desc",
        **page: Any,
    ) -> Iterator[Repository]:
        """Repositories owned by (or visible to) a user."""
        return iter_models(
            Repository,
            self._client.paginate(
                f"/users/{username}/repos",
                params={"type": type, "sort": sort, "direction": direction},
                **page,
            ),
        )

    def list_for_org(
        self,
        org: str,
        *,
        type: str = "all",
        sort: str = "updated",
        direction: str = "desc",
        **page: Any,
    ) -> Iterator[Repository]:
        """Repositories in an organisation."""
        return iter_models(
            Repository,
            self._client.paginate(
                f"/orgs/{org}/repos",
                params={"type": type, "sort": sort, "direction": direction},
                **page,
            ),
        )

    def list_for_authenticated_user(
        self,
        *,
        visibility: str = "all",
        affiliation: str | None = None,
        sort: str = "updated",
        direction: str = "desc",
        **page: Any,
    ) -> Iterator[Repository]:
        """Repositories the authenticated user can see."""
        return iter_models(
            Repository,
            self._client.paginate(
                "/user/repos",
                params={
                    "visibility": visibility,
                    "affiliation": affiliation,
                    "sort": sort,
                    "direction": direction,
                },
                **page,
            ),
        )

    def create(
        self,
        name: str,
        *,
        org: str | None = None,
        description: str | None = None,
        private: bool = False,
        auto_init: bool = False,
        gitignore_template: str | None = None,
        license_template: str | None = None,
        homepage: str | None = None,
        has_issues: bool = True,
        has_wiki: bool = True,
        has_projects: bool | None = None,
    ) -> Repository:
        """Create a repository for the user or (with ``org``) an organisation."""
        payload = {
            "name": name,
            "description": description,
            "private": private,
            "auto_init": auto_init,
            "gitignore_template": gitignore_template,
            "license_template": license_template,
            "homepage": homepage,
            "has_issues": has_issues,
            "has_wiki": has_wiki,
            "has_projects": has_projects,
        }
        path = f"/orgs/{org}/repos" if org else "/user/repos"
        return Repository.model_validate(self._client.post(path, json=_compact(payload)))

    def delete(self, owner: str, repo: str) -> bool:
        """Delete a repository. Returns True on success."""
        self._client.delete(f"/repos/{owner}/{repo}")
        return True

    def update(
        self,
        owner: str,
        repo: str,
        **fields: Any,
    ) -> Repository:
        """Patch repository settings (``description``, ``private``, ...)."""
        return Repository.model_validate(
            self._client.patch(f"/repos/{owner}/{repo}", json=_compact(fields))
        )

    def branches(self, owner: str, repo: str, **page: Any) -> Iterator[Branch]:
        return iter_models(Branch, self._client.paginate(f"/repos/{owner}/{repo}/branches", **page))

    def topics(self, owner: str, repo: str) -> list[str]:
        """Current topic list (requires the Mercy preview accept header)."""
        data = self._client.get(
            f"/repos/{owner}/{repo}/topics",
            accept="application/vnd.github+json",
        )
        return list((data or {}).get("names", []))

    def replace_topics(self, owner: str, repo: str, names: list[str]) -> list[str]:
        data = self._client.put(
            f"/repos/{owner}/{repo}/topics",
            json={"names": names},
            accept="application/vnd.github+json",
        )
        return list((data or {}).get("names", names))

    def releases(self, owner: str, repo: str, **page: Any) -> Iterator[Release]:
        return iter_models(
            Release, self._client.paginate(f"/repos/{owner}/{repo}/releases", **page)
        )

    def latest_release(self, owner: str, repo: str) -> Release | None:
        try:
            data = self._client.get(f"/repos/{owner}/{repo}/releases/latest")
        except Exception:
            return None
        return model_or_none(Release, data)

    def languages(self, owner: str, repo: str) -> dict[str, int]:
        """Map of language name to bytes written."""
        return self._client.get(f"/repos/{owner}/{repo}/languages") or {}

    def readme(self, owner: str, repo: str, *, ref: str | None = None) -> str | None:
        """Decoded README contents."""
        response = self._client.request(
            "GET",
            f"/repos/{owner}/{repo}/readme",
            params={"ref": ref},
            accept="application/vnd.github.raw",
            raw=True,
        )
        return response.text or None

    def file_contents(
        self, owner: str, repo: str, path: str, *, ref: str | None = None
    ) -> str | None:
        """Decoded contents of a single file (``None`` when missing)."""
        try:
            data = self._client.get(
                f"/repos/{owner}/{repo}/contents/{path.lstrip('/')}", params={"ref": ref}
            )
        except Exception:
            return None
        if not isinstance(data, dict) or data.get("encoding") != "base64":
            return None
        try:
            return base64.b64decode(data.get("content") or "").decode("utf-8", "replace")
        except (ValueError, TypeError):  # pragma: no cover - malformed payload
            return None

    def contributors(self, owner: str, repo: str, **page: Any) -> Iterator[dict[str, Any]]:
        return self._client.paginate(f"/repos/{owner}/{repo}/contributors", **page)

    def to_ref(self, owner: str, repo: str) -> RepositoryRef:
        return RepositoryRef(id=0, name=repo, full_name=f"{owner}/{repo}")


def _compact(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}

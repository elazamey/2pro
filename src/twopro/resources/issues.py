"""Issues, issue comments and labels.

The comment endpoints are shared with pull requests - GitHub treats a PR as an
issue with extra fields, so ``client.issues.comment()`` works for both.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime
from typing import Any

from ..models import Comment, Issue, Label
from .base import Resource, ensure_labels, iso, iter_models

__all__ = ["IssuesResource"]


class IssuesResource(Resource):
    """``/repos/{owner}/{repo}/issues`` and the shared comment endpoints."""

    def get(self, owner: str, repo: str, number: int) -> Issue:
        return Issue.model_validate(self._client.get(f"/repos/{owner}/{repo}/issues/{number}"))

    def list(
        self,
        owner: str,
        repo: str,
        *,
        state: str = "open",
        labels: str | list[str] | None = None,
        assignee: str | None = None,
        creator: str | None = None,
        mentioned: str | None = None,
        milestone: str | int | None = None,
        since: datetime | str | None = None,
        sort: str = "created",
        direction: str = "desc",
        **page: Any,
    ) -> Iterator[Issue]:
        """Issues in a repository (pull requests are filtered out by default)."""
        items = self._client.paginate(
            f"/repos/{owner}/{repo}/issues",
            params={
                "state": state,
                "labels": ",".join(ensure_labels(labels) or []) or None,
                "assignee": assignee,
                "creator": creator,
                "mentioned": mentioned,
                "milestone": milestone,
                "since": iso(since),
                "sort": sort,
                "direction": direction,
            },
            **page,
        )
        return iter_models(Issue, (item for item in items if not item.get("pull_request")))

    def list_all(
        self,
        owner: str,
        repo: str,
        *,
        state: str = "open",
        labels: str | list[str] | None = None,
        sort: str = "created",
        direction: str = "desc",
        **page: Any,
    ) -> Iterator[Issue]:
        """Like :meth:`list` but keeps pull requests in the result (GitHub's default)."""
        return iter_models(
            Issue,
            self._client.paginate(
                f"/repos/{owner}/{repo}/issues",
                params={
                    "state": state,
                    "labels": ",".join(ensure_labels(labels) or []) or None,
                    "sort": sort,
                    "direction": direction,
                },
                **page,
            ),
        )

    def list_for_authenticated_user(
        self,
        *,
        state: str = "open",
        filter: str = "assigned",
        sort: str = "updated",
        direction: str = "desc",
        **page: Any,
    ) -> Iterator[Issue]:
        """Issues assigned to / created by / mentioning the current user."""
        return iter_models(
            Issue,
            self._client.paginate(
                "/issues",
                params={
                    "state": state,
                    "filter": filter,
                    "sort": sort,
                    "direction": direction,
                },
                **page,
            ),
        )

    def create(
        self,
        owner: str,
        repo: str,
        title: str,
        *,
        body: str | None = None,
        labels: str | list[str] | None = None,
        assignees: str | list[str] | None = None,
        milestone: int | None = None,
    ) -> Issue:
        """Open a new issue."""
        payload = {
            "title": title,
            "body": body,
            "labels": ensure_labels(labels),
            "assignees": ensure_labels(assignees),
            "milestone": milestone,
        }
        data = self._client.post(f"/repos/{owner}/{repo}/issues", json=_compact(payload))
        return Issue.model_validate(data)

    def update(
        self,
        owner: str,
        repo: str,
        number: int,
        *,
        title: str | None = None,
        body: str | None = None,
        state: str | None = None,
        state_reason: str | None = None,
        labels: str | list[str] | None = None,
        assignees: str | list[str] | None = None,
        milestone: int | None = None,
    ) -> Issue:
        """Edit an issue (only the supplied fields are sent)."""
        payload = {
            "title": title,
            "body": body,
            "state": state,
            "state_reason": state_reason,
            "labels": ensure_labels(labels),
            "assignees": ensure_labels(assignees),
            "milestone": milestone,
        }
        data = self._client.patch(f"/repos/{owner}/{repo}/issues/{number}", json=_compact(payload))
        return Issue.model_validate(data)

    def close(self, owner: str, repo: str, number: int, *, reason: str = "completed") -> Issue:
        """Close an issue (``reason`` is ``completed`` or ``not_planned``)."""
        return self.update(owner, repo, number, state="closed", state_reason=reason)

    def reopen(self, owner: str, repo: str, number: int) -> Issue:
        return self.update(owner, repo, number, state="open")

    def lock(self, owner: str, repo: str, number: int, *, reason: str = "resolved") -> bool:
        self._client.put(
            f"/repos/{owner}/{repo}/issues/{number}/lock", json={"lock_reason": reason}
        )
        return True

    def unlock(self, owner: str, repo: str, number: int) -> bool:
        self._client.delete(f"/repos/{owner}/{repo}/issues/{number}/lock")
        return True

    # --------------------------------------------------------------- comments

    def comments(self, owner: str, repo: str, number: int, **page: Any) -> Iterator[Comment]:
        return iter_models(
            Comment,
            self._client.paginate(f"/repos/{owner}/{repo}/issues/{number}/comments", **page),
        )

    def comment(self, owner: str, repo: str, number: int, body: str) -> Comment:
        """Add a comment to an issue **or** a pull request."""
        data = self._client.post(
            f"/repos/{owner}/{repo}/issues/{number}/comments", json={"body": body}
        )
        return Comment.model_validate(data)

    def update_comment(self, owner: str, repo: str, comment_id: int, body: str) -> Comment:
        data = self._client.patch(
            f"/repos/{owner}/{repo}/issues/comments/{comment_id}", json={"body": body}
        )
        return Comment.model_validate(data)

    def delete_comment(self, owner: str, repo: str, comment_id: int) -> bool:
        self._client.delete(f"/repos/{owner}/{repo}/issues/comments/{comment_id}")
        return True

    # ----------------------------------------------------------------- labels

    def add_labels(self, owner: str, repo: str, number: int, labels: list[str]) -> list[Label]:
        data = self._client.post(
            f"/repos/{owner}/{repo}/issues/{number}/labels", json={"labels": labels}
        )
        return [Label.model_validate(item) for item in data or []]

    def remove_label(self, owner: str, repo: str, number: int, label: str) -> bool:
        self._client.delete(f"/repos/{owner}/{repo}/issues/{number}/labels/{label}")
        return True

    def set_labels(self, owner: str, repo: str, number: int, labels: list[str]) -> list[Label]:
        data = self._client.put(
            f"/repos/{owner}/{repo}/issues/{number}/labels", json={"labels": labels}
        )
        return [Label.model_validate(item) for item in data or []]

    def list_labels(self, owner: str, repo: str, **page: Any) -> Iterator[Label]:
        return iter_models(Label, self._client.paginate(f"/repos/{owner}/{repo}/labels", **page))


def _compact(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}

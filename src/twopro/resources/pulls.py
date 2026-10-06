"""Pull requests: files, reviews, merge and CI status."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from ..models import Comment, Commit, PullRequest, Review
from .base import Resource, ensure_labels, iter_models

__all__ = ["PullsResource"]

CHECK_RUNS_ACCEPT = "application/vnd.github+json"


class PullsResource(Resource):
    """``/repos/{owner}/{repo}/pulls``."""

    def get(self, owner: str, repo: str, number: int) -> PullRequest:
        return PullRequest.model_validate(self._client.get(f"/repos/{owner}/{repo}/pulls/{number}"))

    def list(
        self,
        owner: str,
        repo: str,
        *,
        state: str = "open",
        head: str | None = None,
        base: str | None = None,
        sort: str = "created",
        direction: str = "desc",
        **page: Any,
    ) -> Iterator[PullRequest]:
        return iter_models(
            PullRequest,
            self._client.paginate(
                f"/repos/{owner}/{repo}/pulls",
                params={
                    "state": state,
                    "head": head,
                    "base": base,
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
        *,
        title: str,
        head: str,
        base: str,
        body: str | None = None,
        draft: bool = False,
        maintainer_can_modify: bool | None = None,
        issue: int | None = None,
    ) -> PullRequest:
        """Open a pull request (``issue`` converts an existing issue into a PR)."""
        payload = {
            "title": title,
            "head": head,
            "base": base,
            "body": body,
            "draft": draft,
            "maintainer_can_modify": maintainer_can_modify,
            "issue": issue,
        }
        data = self._client.post(f"/repos/{owner}/{repo}/pulls", json=_compact(payload))
        return PullRequest.model_validate(data)

    def update(
        self,
        owner: str,
        repo: str,
        number: int,
        *,
        title: str | None = None,
        body: str | None = None,
        state: str | None = None,
        base: str | None = None,
        labels: list[str] | None = None,
        assignees: list[str] | None = None,
    ) -> PullRequest:
        payload = {
            "title": title,
            "body": body,
            "state": state,
            "base": base,
            "labels": ensure_labels(labels),
            "assignees": ensure_labels(assignees),
        }
        data = self._client.patch(f"/repos/{owner}/{repo}/pulls/{number}", json=_compact(payload))
        return PullRequest.model_validate(data)

    def merge(
        self,
        owner: str,
        repo: str,
        number: int,
        *,
        method: str = "merge",
        commit_title: str | None = None,
        commit_message: str | None = None,
        sha: str | None = None,
    ) -> dict[str, Any]:
        """Merge a pull request (``method``: merge | squash | rebase)."""
        payload = {
            "merge_method": method,
            "commit_title": commit_title,
            "commit_message": commit_message,
            "sha": sha,
        }
        return (
            self._client.put(f"/repos/{owner}/{repo}/pulls/{number}/merge", json=_compact(payload))
            or {}
        )

    def close(self, owner: str, repo: str, number: int) -> PullRequest:
        return self.update(owner, repo, number, state="closed")

    def files(self, owner: str, repo: str, number: int, **page: Any) -> Iterator[dict[str, Any]]:
        """Changed files with ``additions``/``deletions``/``patch`` per file."""
        return self._client.paginate(f"/repos/{owner}/{repo}/pulls/{number}/files", **page)

    def commits(self, owner: str, repo: str, number: int, **page: Any) -> Iterator[Commit]:
        return iter_models(
            Commit, self._client.paginate(f"/repos/{owner}/{repo}/pulls/{number}/commits", **page)
        )

    def reviews(self, owner: str, repo: str, number: int, **page: Any) -> Iterator[Review]:
        return iter_models(
            Review, self._client.paginate(f"/repos/{owner}/{repo}/pulls/{number}/reviews", **page)
        )

    def request_reviewers(
        self,
        owner: str,
        repo: str,
        number: int,
        *,
        reviewers: list[str] | None = None,
        team_reviewers: list[str] | None = None,
    ) -> PullRequest:
        payload = {"reviewers": reviewers or [], "team_reviewers": team_reviewers or []}
        data = self._client.post(
            f"/repos/{owner}/{repo}/pulls/{number}/requested_reviewers", json=payload
        )
        return PullRequest.model_validate(data)

    def create_review(
        self,
        owner: str,
        repo: str,
        number: int,
        *,
        event: str = "COMMENT",
        body: str | None = None,
        commit_id: str | None = None,
    ) -> Review:
        """Submit a review: ``APPROVE``, ``REQUEST_CHANGES`` or ``COMMENT``."""
        payload = {"event": event, "body": body, "commit_id": commit_id}
        data = self._client.post(
            f"/repos/{owner}/{repo}/pulls/{number}/reviews", json=_compact(payload)
        )
        return Review.model_validate(data)

    def comments(self, owner: str, repo: str, number: int, **page: Any) -> Iterator[Comment]:
        """Review comments (inline). Use ``issues.comments`` for the timeline."""
        return iter_models(
            Comment,
            self._client.paginate(f"/repos/{owner}/{repo}/pulls/{number}/comments", **page),
        )

    # ------------------------------------------------------------------- CI

    def check_runs(self, owner: str, repo: str, ref: str, **page: Any) -> Iterator[dict[str, Any]]:
        """Check runs for a commit sha or branch."""
        return self._client.paginate(
            f"/repos/{owner}/{repo}/commits/{ref}/check-runs",
            items_key="check_runs",
            accept=CHECK_RUNS_ACCEPT,
            **page,
        )

    def combined_status(self, owner: str, repo: str, ref: str) -> dict[str, Any]:
        """Legacy combined commit status plus every individual status."""
        return self._client.get(f"/repos/{owner}/{repo}/commits/{ref}/status") or {}

    def is_green(self, owner: str, repo: str, number: int) -> bool:
        """True when every check on the PR head commit succeeded."""
        pr = self.get(owner, repo, number)
        if not pr.head:
            return False
        status = self.combined_status(owner, repo, pr.head.sha)
        state = status.get("state")
        return state == "success"


def _compact(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}

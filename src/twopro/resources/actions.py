"""GitHub Actions: workflows, runs, jobs, logs and artifacts."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from ..models import Artifact, Job, Workflow, WorkflowRun
from .base import Resource, iter_models

__all__ = ["ActionsResource"]

TERMINAL_STATES = {"completed"}


class ActionsResource(Resource):
    """``/repos/{owner}/{repo}/actions``."""

    def workflows(self, owner: str, repo: str, **page: Any) -> Iterator[Workflow]:
        return iter_models(
            Workflow,
            self._client.paginate(
                f"/repos/{owner}/{repo}/actions/workflows", items_key="workflows", **page
            ),
        )

    def runs(
        self,
        owner: str,
        repo: str,
        *,
        branch: str | None = None,
        event: str | None = None,
        status: str | None = None,
        actor: str | None = None,
        workflow_id: int | str | None = None,
        head_sha: str | None = None,
        exclude_pull_requests: bool = False,
        created: str | None = None,
        **page: Any,
    ) -> Iterator[WorkflowRun]:
        """List workflow runs, newest first."""
        if workflow_id:
            path = f"/repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs"
        else:
            path = f"/repos/{owner}/{repo}/actions/runs"
        return iter_models(
            WorkflowRun,
            self._client.paginate(
                path,
                items_key="workflow_runs",
                params={
                    "branch": branch,
                    "event": event,
                    "status": status,
                    "actor": actor,
                    "head_sha": head_sha,
                    "exclude_pull_requests": exclude_pull_requests or None,
                    "created": created,
                },
                **page,
            ),
        )

    def run(self, owner: str, repo: str, run_id: int, *, attempt: int | None = None) -> WorkflowRun:
        path = f"/repos/{owner}/{repo}/actions/runs/{run_id}"
        if attempt:
            path = f"{path}/attempts/{attempt}"
        return WorkflowRun.model_validate(self._client.get(path))

    def latest_run(self, owner: str, repo: str, **kwargs: Any) -> WorkflowRun | None:
        """The most recent run (optionally filtered like :meth:`runs`)."""
        for run in self.runs(owner, repo, max_items=1, **kwargs):
            return run
        return None

    def rerun(self, owner: str, repo: str, run_id: int, *, failed_only: bool = False) -> bool:
        """Re-run a workflow run (or only its failed jobs)."""
        path = f"/repos/{owner}/{repo}/actions/runs/{run_id}/"
        path += "rerun-failed-jobs" if failed_only else "rerun"
        self._client.post(path)
        return True

    def cancel(self, owner: str, repo: str, run_id: int) -> bool:
        self._client.post(f"/repos/{owner}/{repo}/actions/runs/{run_id}/cancel")
        return True

    def jobs(self, owner: str, repo: str, run_id: int, **page: Any) -> Iterator[Job]:
        return iter_models(
            Job,
            self._client.paginate(
                f"/repos/{owner}/{repo}/actions/runs/{run_id}/jobs", items_key="jobs", **page
            ),
        )

    def artifacts(self, owner: str, repo: str, run_id: int, **page: Any) -> Iterator[Artifact]:
        return iter_models(
            Artifact,
            self._client.paginate(
                f"/repos/{owner}/{repo}/actions/runs/{run_id}/artifacts",
                items_key="artifacts",
                **page,
            ),
        )

    def logs(self, owner: str, repo: str, run_id: int) -> bytes:
        """Download the run log archive as bytes (a zip file)."""
        chunks = self._client.stream("GET", f"/repos/{owner}/{repo}/actions/runs/{run_id}/logs")
        return b"".join(chunks)

    def job_logs(self, owner: str, repo: str, job_id: int) -> bytes:
        chunks = self._client.stream("GET", f"/repos/{owner}/{repo}/actions/jobs/{job_id}/logs")
        return b"".join(chunks)

    def download_artifact(self, owner: str, repo: str, artifact_id: int) -> bytes:
        """Download an artifact zip (follows the signed redirect)."""
        chunks = self._client.stream(
            "GET",
            f"/repos/{owner}/{repo}/actions/artifacts/{artifact_id}/zip",
            headers={"Accept": "application/vnd.github+json"},
        )
        return b"".join(chunks)

    def delete_artifact(self, owner: str, repo: str, artifact_id: int) -> bool:
        self._client.delete(f"/repos/{owner}/{repo}/actions/artifacts/{artifact_id}")
        return True

    def dispatch(
        self,
        owner: str,
        repo: str,
        workflow_id: int | str,
        *,
        ref: str = "main",
        inputs: dict[str, Any] | None = None,
    ) -> bool:
        """Trigger a ``workflow_dispatch`` run."""
        self._client.post(
            f"/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
            json={"ref": ref, "inputs": inputs or {}},
        )
        return True

    def secrets(self, owner: str, repo: str, **page: Any) -> Iterator[dict[str, Any]]:
        """Repository secret names (values are never returned by the API)."""
        return self._client.paginate(
            f"/repos/{owner}/{repo}/actions/secrets", items_key="secrets", **page
        )

    def usage(self, owner: str, repo: str) -> dict[str, Any]:
        """Billed workflow minutes for the repository."""
        return self._client.get(f"/repos/{owner}/{repo}/actions/cache/usage") or {}

"""FastAPI application serving the dashboard UI and a JSON API.

The browser never sees the GitHub token: every request is proxied through the
server-side :class:`~twopro.GitHub` instance.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .._version import __version__
from ..automation import build_digest, review_pr
from ..errors import GitHubError, RateLimitError, TwoProError
from ..github import GitHub
from ..models import RateLimit

__all__ = ["create_app"]

logger = logging.getLogger("twopro.web")

STATIC_DIR = Path(__file__).parent / "static"
API_TAG = "api"


class IssueCreate(BaseModel):
    title: str = Field(min_length=1, max_length=256)
    body: str | None = None
    labels: list[str] = Field(default_factory=list)


class CommentCreate(BaseModel):
    body: str = Field(min_length=1)


class CloseRequest(BaseModel):
    reason: str = "completed"
    comment: str | None = None


class MergeRequest(BaseModel):
    method: str = "merge"


class DispatchRequest(BaseModel):
    ref: str = "main"
    inputs: dict[str, Any] = Field(default_factory=dict)


def create_app(
    token: str | None = None,
    *,
    github: GitHub | None = None,
    static_dir: Path | None = None,
) -> FastAPI:
    """Build the dashboard application.

    ``github`` can be injected (tests, or an app embedding 2pro); otherwise a
    client is created lazily from the usual credential chain.
    """

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.github = github or GitHub(token)
        app.state.owns_client = github is None
        yield
        if app.state.owns_client:
            app.state.github.close()

    app = FastAPI(
        title="2pro dashboard",
        description="Live GitHub control room for repositories, issues, pull requests and Actions.",
        version=__version__,
        lifespan=lifespan,
    )

    def get_github(request: Request) -> GitHub:
        return request.app.state.github

    def rate_payload(gh: GitHub, *, refresh: bool = False) -> dict[str, Any]:
        """Rate-limit snapshot; only ``refresh`` spends an extra API call."""
        limit: RateLimit | None = (
            gh.client.rate_limit_status(refresh=True) if refresh else gh.client.rate_limit
        )
        if limit is None:
            return {}
        return {
            "limit": limit.limit,
            "used": limit.used,
            "remaining": limit.remaining,
            "reset": limit.reset,
            "reset_in": int(limit.seconds_until_reset),
            "used_ratio": round(limit.used_ratio, 3),
        }

    # ------------------------------------------------------------ static UI

    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        return FileResponse(static_dir or STATIC_DIR / "index.html")

    app.mount(
        "/static",
        StaticFiles(directory=str(static_dir or STATIC_DIR)),
        name="static",
    )

    # ------------------------------------------------------------------ meta

    @app.get("/api/health", tags=[API_TAG])
    async def health(gh: GitHub = Depends(get_github)) -> dict[str, Any]:
        return {
            "ok": True,
            "version": __version__,
            "host": gh.settings.hostname,
            "authenticated": gh.client.is_authenticated,
        }

    @app.get("/api/me", tags=[API_TAG])
    async def me(gh: GitHub = Depends(get_github)) -> dict[str, Any]:
        user = gh.me()
        return {
            "login": user.login,
            "name": user.name,
            "avatar_url": user.avatar_url,
            "html_url": user.html_url,
            "public_repos": user.public_repos,
            "token": gh.credential.source.value if gh.credential else None,
        }

    @app.get("/api/rate-limit", tags=[API_TAG])
    async def rate_limit(gh: GitHub = Depends(get_github)) -> dict[str, Any]:
        return rate_payload(gh, refresh=True)

    # ----------------------------------------------------------------- repos

    @app.get("/api/repos", tags=[API_TAG])
    async def list_repos(
        gh: GitHub = Depends(get_github),
        q: str | None = Query(None, description="Search query; omit to list your repositories."),
        org: str | None = None,
        user: str | None = None,
        per_page: int = Query(30, ge=1, le=100),
    ) -> dict[str, Any]:
        if q:
            repos = gh.search.repositories(q, max_items=per_page)
        elif org:
            repos = gh.orgs.repos(org, max_items=per_page)
        elif user:
            repos = gh.repos.list_for_user(user, max_items=per_page)
        else:
            repos = gh.repos.list_for_authenticated_user(sort="pushed", max_items=per_page)
        return {
            "items": [_repo_json(r) for r in repos],
            "rate_limit": rate_payload(gh),
        }

    @app.get("/api/orgs", tags=[API_TAG])
    async def list_orgs(gh: GitHub = Depends(get_github)) -> dict[str, Any]:
        orgs = [
            {"login": o.login, "avatar_url": o.avatar_url}
            for o in gh.orgs.list_for_authenticated_user()
        ]
        return {"items": orgs}

    @app.get("/api/repos/{owner}/{repo}", tags=[API_TAG])
    async def repo_detail(owner: str, repo: str, gh: GitHub = Depends(get_github)):
        return _repo_json(gh.repos.get(owner, repo))

    @app.get("/api/repos/{owner}/{repo}/issues", tags=[API_TAG])
    async def list_issues(
        owner: str,
        repo: str,
        gh: GitHub = Depends(get_github),
        state: str = "open",
        limit: int = Query(30, ge=1, le=200),
    ):
        issues = gh.issues.list(owner, repo, state=state, sort="updated", max_items=limit)
        return {"items": [_issue_json(i) for i in issues]}

    @app.post("/api/repos/{owner}/{repo}/issues", tags=[API_TAG])
    async def create_issue(
        owner: str, repo: str, payload: IssueCreate, gh: GitHub = Depends(get_github)
    ):
        issue = gh.issues.create(
            owner, repo, payload.title, body=payload.body, labels=payload.labels or None
        )
        return _issue_json(issue)

    @app.post("/api/repos/{owner}/{repo}/issues/{number}/comments", tags=[API_TAG])
    async def comment_issue(
        owner: str, repo: str, number: int, payload: CommentCreate, gh: GitHub = Depends(get_github)
    ):
        comment = gh.issues.comment(owner, repo, number, payload.body)
        return {"id": comment.id, "html_url": comment.html_url}

    @app.post("/api/repos/{owner}/{repo}/issues/{number}/close", tags=[API_TAG])
    async def close_issue(
        owner: str, repo: str, number: int, payload: CloseRequest, gh: GitHub = Depends(get_github)
    ):
        if payload.comment:
            gh.issues.comment(owner, repo, number, payload.comment)
        issue = gh.issues.close(owner, repo, number, reason=payload.reason)
        return _issue_json(issue)

    # ------------------------------------------------------------------ pulls

    @app.get("/api/repos/{owner}/{repo}/pulls", tags=[API_TAG])
    async def list_pulls(
        owner: str,
        repo: str,
        gh: GitHub = Depends(get_github),
        state: str = "open",
        limit: int = Query(30, ge=1, le=200),
    ):
        prs = gh.pulls.list(owner, repo, state=state, sort="updated", max_items=limit)
        return {"items": [_pr_json(p) for p in prs]}

    @app.post("/api/repos/{owner}/{repo}/pulls/{number}/merge", tags=[API_TAG])
    async def merge_pull(
        owner: str, repo: str, number: int, payload: MergeRequest, gh: GitHub = Depends(get_github)
    ):
        result = gh.pulls.merge(owner, repo, number, method=payload.method)
        if not result.get("merged"):
            raise HTTPException(status_code=409, detail=result.get("message") or "not merged")
        return {"merged": True, "message": result.get("message")}

    # ---------------------------------------------------------------- actions

    @app.get("/api/repos/{owner}/{repo}/workflows", tags=[API_TAG])
    async def list_workflows(owner: str, repo: str, gh: GitHub = Depends(get_github)):
        workflows = [
            {"id": w.id, "name": w.name, "path": w.path, "state": w.state}
            for w in gh.actions.workflows(owner, repo, max_items=50)
        ]
        return {"items": workflows}

    @app.get("/api/repos/{owner}/{repo}/runs", tags=[API_TAG])
    async def list_runs(
        owner: str,
        repo: str,
        gh: GitHub = Depends(get_github),
        status: str | None = None,
        branch: str | None = None,
        limit: int = Query(20, ge=1, le=100),
    ):
        runs = gh.actions.runs(owner, repo, status=status, branch=branch, max_items=limit)
        return {"items": [_run_json(r) for r in runs]}

    @app.get("/api/repos/{owner}/{repo}/runs/{run_id}", tags=[API_TAG])
    async def run_detail(owner: str, repo: str, run_id: int, gh: GitHub = Depends(get_github)):
        run = gh.actions.run(owner, repo, run_id)
        jobs = [
            {
                "id": j.id,
                "name": j.name,
                "status": j.status,
                "conclusion": j.conclusion,
                "duration": j.duration_seconds,
            }
            for j in gh.actions.jobs(owner, repo, run_id, max_items=50)
        ]
        return {"run": _run_json(run), "jobs": jobs}

    @app.post("/api/repos/{owner}/{repo}/runs/{run_id}/rerun", tags=[API_TAG])
    async def rerun_run(
        owner: str,
        repo: str,
        run_id: int,
        gh: GitHub = Depends(get_github),
        failed_only: bool = False,
    ):
        gh.actions.rerun(owner, repo, run_id, failed_only=failed_only)
        return {"ok": True}

    @app.post("/api/repos/{owner}/{repo}/runs/{run_id}/cancel", tags=[API_TAG])
    async def cancel_run(owner: str, repo: str, run_id: int, gh: GitHub = Depends(get_github)):
        gh.actions.cancel(owner, repo, run_id)
        return {"ok": True}

    @app.post("/api/repos/{owner}/{repo}/workflows/{workflow_id}/dispatch", tags=[API_TAG])
    async def dispatch_workflow(
        owner: str,
        repo: str,
        workflow_id: str,
        payload: DispatchRequest,
        gh: GitHub = Depends(get_github),
    ):
        gh.actions.dispatch(owner, repo, workflow_id, ref=payload.ref, inputs=payload.inputs)
        return {"ok": True}

    # -------------------------------------------------------------- automations

    @app.get("/api/repos/{owner}/{repo}/digest", tags=[API_TAG])
    async def digest(
        owner: str,
        repo: str,
        gh: GitHub = Depends(get_github),
        days: int = Query(7, ge=1, le=90),
    ):
        report = build_digest(gh, f"{owner}/{repo}", days=days)
        return {"markdown": report.markdown, "days": days}

    @app.post("/api/repos/{owner}/{repo}/pulls/{number}/review", tags=[API_TAG])
    async def review(
        owner: str, repo: str, number: int, gh: GitHub = Depends(get_github), post: bool = False
    ):
        report = review_pr(gh, f"{owner}/{repo}", number, post=post, dry_run=False)
        return {
            "verdict": report.verdict,
            "markdown": report.markdown,
            "errors": [f.message for f in report.errors],
            "warnings": [f.message for f in report.warnings],
            "posted": report.posted,
        }

    # ------------------------------------------------------------ error mapping

    @app.exception_handler(GitHubError)
    async def github_error_handler(request: Request, exc: GitHubError) -> JSONResponse:
        status = (
            exc.status_code if isinstance(exc.status_code, int) and exc.status_code >= 400 else 502
        )
        payload: dict[str, Any] = {
            "detail": str(exc),
            "status": exc.status_code,
            "documentation_url": exc.documentation_url,
        }
        if isinstance(exc, RateLimitError):
            payload["reset_in"] = exc.wait_seconds
            status = 429
        return JSONResponse(status_code=status, content=payload)

    @app.exception_handler(TwoProError)
    async def twopro_error_handler(request: Request, exc: TwoProError) -> JSONResponse:
        return JSONResponse(
            status_code=401 if "credential" in str(exc).lower() else 500,
            content={"detail": str(exc)},
        )

    return app


# --------------------------------------------------------------------------- #


def _repo_json(repo) -> dict[str, Any]:
    return {
        "full_name": repo.full_name,
        "name": repo.name,
        "owner": repo.owner.login if repo.owner else "",
        "description": repo.description or "",
        "private": repo.private,
        "language": repo.language,
        "stars": repo.stargazers_count,
        "forks": repo.forks_count,
        "open_issues": repo.open_issues_count,
        "default_branch": repo.default_branch,
        "pushed_at": repo.pushed_at.isoformat() if repo.pushed_at else None,
        "updated_at": repo.updated_at.isoformat() if repo.updated_at else None,
        "archived": repo.archived,
        "topics": repo.topics,
        "html_url": repo.html_url,
    }


def _issue_json(issue) -> dict[str, Any]:
    return {
        "number": issue.number,
        "title": issue.title,
        "body": issue.body or "",
        "state": issue.state,
        "user": issue.user.login if issue.user else None,
        "avatar": issue.user.avatar_url if issue.user else None,
        "labels": issue.label_names,
        "comments": issue.comments,
        "created_at": issue.created_at.isoformat() if issue.created_at else None,
        "updated_at": issue.updated_at.isoformat() if issue.updated_at else None,
        "html_url": issue.html_url,
        "is_pull_request": issue.is_pull_request,
    }


def _pr_json(pr) -> dict[str, Any]:
    return {
        "number": pr.number,
        "title": pr.title,
        "state": "merged" if pr.is_merged else pr.state,
        "user": pr.user.login if pr.user else None,
        "avatar": pr.user.avatar_url if pr.user else None,
        "draft": pr.draft,
        "head": pr.head_ref,
        "base": pr.base_ref,
        "additions": pr.additions,
        "deletions": pr.deletions,
        "changed_files": pr.changed_files,
        "commits": pr.commits,
        "labels": pr.label_names,
        "reviewers": [r.login for r in pr.requested_reviewers],
        "mergeable": pr.mergeable,
        "created_at": pr.created_at.isoformat() if pr.created_at else None,
        "updated_at": pr.updated_at.isoformat() if pr.updated_at else None,
        "html_url": pr.html_url,
    }


def _run_json(run) -> dict[str, Any]:
    return {
        "id": run.id,
        "name": run.name,
        "display_title": run.display_title,
        "status": run.status,
        "conclusion": run.conclusion,
        "icon": run.icon,
        "event": run.event,
        "branch": run.head_branch,
        "sha": (run.head_sha or "")[:8],
        "run_number": run.run_number,
        "actor": run.actor.login if run.actor else None,
        "duration": run.duration_seconds,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "updated_at": run.updated_at.isoformat() if run.updated_at else None,
        "html_url": run.html_url,
    }

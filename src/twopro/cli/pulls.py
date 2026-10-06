"""``2pro pr`` - pull requests: listing, checks, reviews and merging."""

from __future__ import annotations

from typing import Annotated

import typer

from ._common import handle_errors, split_repo

__all__ = ["app"]

app = typer.Typer(name="pr", no_args_is_help=True, rich_markup_mode="rich")

PR_COLUMNS = [
    ("number", "#"),
    ("title", "Title"),
    ("state", "State"),
    ("author", "Author"),
    ("branch", "Branch"),
    ("changes", "+/-"),
    ("files", "Files"),
    ("updated", "Updated"),
    ("draft", "Draft"),
]


def _row(pr) -> dict:
    state = "merged" if pr.is_merged else pr.state
    return {
        "number": pr.number,
        "title": pr.title,
        "state": state,
        "author": pr.user.login if pr.user else "-",
        "branch": f"{pr.head_ref or '?'} → {pr.base_ref or '?'}",
        "changes": f"+{pr.additions}/-{pr.deletions}",
        "files": pr.changed_files,
        "commits": pr.commits,
        "draft": "draft" if pr.draft else "",
        "mergeable": {True: "yes", False: "conflict", None: "unknown"}[pr.mergeable],
        "labels": ", ".join(pr.label_names),
        "created": pr.created_at.strftime("%Y-%m-%d") if pr.created_at else "-",
        "updated": pr.updated_at.strftime("%Y-%m-%d %H:%M") if pr.updated_at else "-",
        "url": pr.html_url or "",
        "body": pr.body or "",
    }


@app.command("list")
@handle_errors
def list_prs(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument(help="owner/repo")],
    state: Annotated[str, typer.Option("--state", "-s", help="open | closed | all")] = "open",
    base: Annotated[str | None, typer.Option("--base", help="Filter by base branch.")] = None,
    limit: Annotated[int, typer.Option("--limit", "-n", min=1)] = 30,
) -> None:
    """List pull requests."""
    owner, name = split_repo(repo)
    prs = ctx.obj.github.pulls.list(owner, name, state=state, base=base, max_items=limit)
    ctx.obj.out.rows([_row(p) for p in prs], columns=PR_COLUMNS, empty="No pull requests found.")


@app.command("view")
@handle_errors
def view(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    number: Annotated[int, typer.Argument()],
) -> None:
    """Show one pull request."""
    owner, name = split_repo(repo)
    pr = ctx.obj.github.pulls.get(owner, name, number)
    ctx.obj.out.detail(
        _row(pr),
        fields=[
            ("number", "#"),
            ("title", "Title"),
            ("state", "State"),
            ("author", "Author"),
            ("branch", "Branch"),
            ("changes", "Changes"),
            ("files", "Files"),
            ("commits", "Commits"),
            ("mergeable", "Mergeable"),
            ("labels", "Labels"),
            ("created", "Created"),
            ("updated", "Updated"),
            ("url", "URL"),
        ],
        title=f"{owner}/{name}#{number}",
    )


@app.command("create")
@handle_errors
def create(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    title: Annotated[str, typer.Option("--title", "-t", prompt=True)],
    head: Annotated[str, typer.Option("--head", prompt="head branch")],
    base: Annotated[str, typer.Option("--base", prompt="base branch")] = "main",
    body: Annotated[str | None, typer.Option("--body", "-b")] = None,
    draft: Annotated[bool, typer.Option("--draft/--ready", help="Open as a draft.")] = False,
) -> None:
    """Open a pull request."""
    owner, name = split_repo(repo)
    pr = ctx.obj.github.pulls.create(
        owner, name, title=title, head=head, base=base, body=body, draft=draft
    )
    ctx.obj.out.success(f"opened #{pr.number}: {pr.html_url}")


@app.command("edit")
@handle_errors
def edit(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    number: Annotated[int, typer.Argument()],
    title: Annotated[str | None, typer.Option("--title", "-t")] = None,
    body: Annotated[str | None, typer.Option("--body", "-b")] = None,
    base: Annotated[str | None, typer.Option("--base", help="Change the target branch.")] = None,
    state: Annotated[str | None, typer.Option("--state", help="open | closed")] = None,
) -> None:
    """Edit a pull request."""
    owner, name = split_repo(repo)
    if not any([title, body, base, state]):
        ctx.obj.out.error("Nothing to change: pass --title, --body, --base or --state.")
        raise typer.Exit(2)
    pr = ctx.obj.github.pulls.update(
        owner, name, number, title=title, body=body, base=base, state=state
    )
    ctx.obj.out.success(f"updated #{pr.number}")
    ctx.obj.out.detail(
        _row(pr),
        fields=[
            ("number", "#"),
            ("title", "Title"),
            ("state", "State"),
            ("branch", "Branch"),
            ("url", "URL"),
        ],
    )


@app.command("merge")
@handle_errors
def merge(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    number: Annotated[int, typer.Argument()],
    method: Annotated[
        str, typer.Option("--method", "-m", help="merge | squash | rebase")
    ] = "merge",
    commit_title: Annotated[str | None, typer.Option("--commit-title")] = None,
    yes: Annotated[bool, typer.Option("--yes", "-y")] = False,
) -> None:
    """Merge a pull request."""
    owner, name = split_repo(repo)
    if not yes and not typer.confirm(f"Merge {owner}/{name}#{number} with '{method}'?"):
        raise typer.Abort()
    result = ctx.obj.github.pulls.merge(
        owner, name, number, method=method, commit_title=commit_title
    )
    if result.get("merged"):
        ctx.obj.out.success(f"merged #{number}: {result.get('message')}")
    else:
        ctx.obj.out.error(result.get("message") or "merge was not performed")
        raise typer.Exit(1)


@app.command("close")
@handle_errors
def close(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    number: Annotated[int, typer.Argument()],
) -> None:
    """Close a pull request without merging."""
    owner, name = split_repo(repo)
    ctx.obj.github.pulls.close(owner, name, number)
    ctx.obj.out.success(f"closed #{number}")


@app.command("files")
@handle_errors
def files(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    number: Annotated[int, typer.Argument()],
    limit: Annotated[int, typer.Option("--limit", "-n", min=1)] = 100,
) -> None:
    """Changed files with per-file additions/deletions."""
    owner, name = split_repo(repo)
    rows = [
        {
            "file": f["filename"],
            "changes": f"+{f.get('additions', 0)}/-{f.get('deletions', 0)}",
            "status": f.get("status", ""),
        }
        for f in ctx.obj.github.pulls.files(owner, name, number, max_items=limit)
    ]
    ctx.obj.out.rows(
        rows,
        columns=[("file", "File"), ("changes", "Changes"), ("status", "Status")],
        empty="No file changes.",
    )


@app.command("checks")
@handle_errors
def checks(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    number: Annotated[int, typer.Argument()],
) -> None:
    """CI status for the head commit of a pull request."""
    owner, name = split_repo(repo)
    gh = ctx.obj.github
    pr = gh.pulls.get(owner, name, number)
    if not pr.head:
        ctx.obj.out.error("Pull request has no head commit.")
        raise typer.Exit(1)
    sha = pr.head.sha
    status = gh.pulls.combined_status(owner, name, sha)
    rows = [
        {
            "name": s.get("context", "?"),
            "state": s.get("state", ""),
            "description": s.get("description") or "",
        }
        for s in status.get("statuses", [])
    ]
    for run in gh.actions.runs(owner, repo=name, head_sha=sha, max_items=20):
        rows.append(
            {
                "name": run.name or "workflow",
                "state": run.conclusion or run.status or "",
                "description": run.display_title or "",
            }
        )
    ctx.obj.out.status_line(
        [
            ("Overall", status.get("state", "unknown")),
            ("Head sha", sha[:8]),
            ("Checks", len(rows)),
        ]
    )
    if rows:
        ctx.obj.out.message("")
        ctx.obj.out.rows(
            rows,
            columns=[("name", "Check"), ("state", "State"), ("description", "Description")],
            empty="No checks reported.",
        )


@app.command("reviews")
@handle_errors
def reviews(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    number: Annotated[int, typer.Argument()],
) -> None:
    """Reviews submitted on a pull request."""
    owner, name = split_repo(repo)
    rows = [
        {
            "author": r.user.login if r.user else "?",
            "state": (r.state or "").replace("_", " ").lower(),
            "submitted": r.submitted_at.strftime("%Y-%m-%d %H:%M") if r.submitted_at else "-",
            "body": (r.body or "").replace("\n", " "),
        }
        for r in ctx.obj.github.pulls.reviews(owner, name, number)
    ]
    ctx.obj.out.rows(
        rows,
        columns=[
            ("author", "Reviewer"),
            ("state", "Decision"),
            ("submitted", "When"),
            ("body", "Comment"),
        ],
        empty="No reviews yet.",
    )


@app.command("review")
@handle_errors
def review(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    number: Annotated[int, typer.Argument()],
    approve: Annotated[bool, typer.Option("--approve", help="Approve the pull request.")] = False,
    request_changes: Annotated[
        bool, typer.Option("--request-changes", help="Request changes.")
    ] = False,
    body: Annotated[str | None, typer.Option("--body", "-b", help="Review comment.")] = None,
) -> None:
    """Submit a review (``--approve``, ``--request-changes``, or a plain comment)."""
    owner, name = split_repo(repo)
    event = "APPROVE" if approve else ("REQUEST_CHANGES" if request_changes else "COMMENT")
    created = ctx.obj.github.pulls.create_review(owner, name, number, event=event, body=body)
    ctx.obj.out.success(f"review submitted ({event}): {created.html_url}")


@app.command("comment")
@handle_errors
def comment(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    number: Annotated[int, typer.Argument()],
    body: Annotated[str | None, typer.Option("--body", "-b")] = None,
) -> None:
    """Comment on a pull request."""
    owner, name = split_repo(repo)
    if not body:
        ctx.obj.out.error("Nothing to post: pass --body.")
        raise typer.Exit(2)
    created = ctx.obj.github.issues.comment(owner, name, number, body)
    ctx.obj.out.success(f"comment added: {created.html_url}")

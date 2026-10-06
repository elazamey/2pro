"""``2pro issue`` - list, create, close, comment and label issues."""

from __future__ import annotations

from typing import Annotated

import typer

from ._common import handle_errors, split_repo

__all__ = ["app"]

app = typer.Typer(name="issue", no_args_is_help=True, rich_markup_mode="rich")

ISSUE_COLUMNS = [
    ("number", "#"),
    ("title", "Title"),
    ("state", "State"),
    ("author", "Author"),
    ("labels", "Labels"),
    ("comments", "Comments"),
    ("updated", "Updated"),
]


def _row(issue) -> dict:
    return {
        "number": issue.number,
        "title": issue.title,
        "state": issue.state,
        "author": issue.user.login if issue.user else "-",
        "labels": ", ".join(issue.label_names),
        "comments": issue.comments,
        "created": issue.created_at.strftime("%Y-%m-%d") if issue.created_at else "-",
        "updated": issue.updated_at.strftime("%Y-%m-%d %H:%M") if issue.updated_at else "-",
        "url": issue.html_url or "",
        "body": issue.body or "",
    }


@app.command("list")
@handle_errors
def list_issues(
    ctx: typer.Context,
    repo: Annotated[str | None, typer.Argument(help="owner/repo (omit with --mine).")] = None,
    state: Annotated[str, typer.Option("--state", "-s", help="open | closed | all")] = "open",
    label: Annotated[
        str | None, typer.Option("--label", "-l", help="Comma separated labels.")
    ] = None,
    assignee: Annotated[str | None, typer.Option("--assignee", "-a")] = None,
    creator: Annotated[str | None, typer.Option("--creator")] = None,
    limit: Annotated[int, typer.Option("--limit", "-n", min=1)] = 30,
    mine: Annotated[
        bool, typer.Option("--mine", help="Issues assigned to you across repositories.")
    ] = False,
) -> None:
    """List issues (pull requests are excluded)."""
    gh = ctx.obj.github
    if mine:
        issues = gh.issues.list_for_authenticated_user(state=state, max_items=limit)
    elif repo:
        owner, name = split_repo(repo)
        issues = gh.issues.list(
            owner,
            name,
            state=state,
            labels=label,
            assignee=assignee,
            creator=creator,
            max_items=limit,
        )
    else:
        ctx.obj.out.error("Give a repository (owner/repo) or use --mine.")
        raise typer.Exit(2)

    ctx.obj.out.rows([_row(i) for i in issues], columns=ISSUE_COLUMNS, empty="No issues found.")


@app.command("view")
@handle_errors
def view(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    number: Annotated[int, typer.Argument()],
    comments: Annotated[
        bool, typer.Option("--comments", "-c", help="Show the comment thread.")
    ] = False,
) -> None:
    """Show one issue."""
    owner, name = split_repo(repo)
    gh = ctx.obj.github
    issue = gh.issues.get(owner, name, number)
    ctx.obj.out.detail(
        _row(issue),
        fields=[
            ("number", "#"),
            ("title", "Title"),
            ("state", "State"),
            ("author", "Author"),
            ("labels", "Labels"),
            ("created", "Created"),
            ("updated", "Updated"),
            ("url", "URL"),
        ],
        title=f"{owner}/{name}#{number}",
    )
    body = (issue.body or "").strip()
    if body:
        ctx.obj.out.message("")
        ctx.obj.out.value(body)
    if comments:
        for comment in gh.issues.comments(owner, name, number, max_items=50):
            who = comment.user.login if comment.user else "?"
            when = comment.created_at.strftime("%Y-%m-%d %H:%M") if comment.created_at else ""
            ctx.obj.out.message("")
            ctx.obj.out.value(f"[bold]{who}[/bold] · [dim]{when}[/dim]\n{comment.body or ''}")


@app.command("create")
@handle_errors
def create(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    title: Annotated[str, typer.Option("--title", "-t", prompt=True)],
    body: Annotated[str | None, typer.Option("--body", "-b", help="Markdown body.")] = None,
    body_file: Annotated[
        str | None, typer.Option("--body-file", help="Read the body from a file ('-' for stdin).")
    ] = None,
    label: Annotated[
        str | None, typer.Option("--label", "-l", help="Comma separated labels.")
    ] = None,
    assignee: Annotated[
        str | None, typer.Option("--assignee", "-a", help="Comma separated logins.")
    ] = None,
) -> None:
    """Open a new issue."""
    owner, name = split_repo(repo)
    text = _resolve_body(body, body_file)
    issue = ctx.obj.github.issues.create(
        owner, name, title, body=text, labels=label, assignees=assignee
    )
    ctx.obj.out.success(f"opened #{issue.number}: {issue.html_url}")
    ctx.obj.out.detail(
        _row(issue),
        fields=[("number", "#"), ("title", "Title"), ("url", "URL"), ("state", "State")],
    )


@app.command("close")
@handle_errors
def close(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    number: Annotated[int, typer.Argument()],
    reason: Annotated[str, typer.Option("--reason", help="completed | not_planned")] = "completed",
    comment: Annotated[
        str | None, typer.Option("--comment", "-c", help="Comment before closing.")
    ] = None,
) -> None:
    """Close an issue."""
    owner, name = split_repo(repo)
    gh = ctx.obj.github
    if comment:
        gh.issues.comment(owner, name, number, comment)
    issue = gh.issues.close(owner, name, number, reason=reason)
    ctx.obj.out.success(f"closed #{issue.number} ({reason})")


@app.command("reopen")
@handle_errors
def reopen(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    number: Annotated[int, typer.Argument()],
) -> None:
    """Reopen a closed issue."""
    owner, name = split_repo(repo)
    issue = ctx.obj.github.issues.reopen(owner, name, number)
    ctx.obj.out.success(f"reopened #{issue.number}")


@app.command("comment")
@handle_errors
def comment(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    number: Annotated[int, typer.Argument()],
    body: Annotated[str | None, typer.Option("--body", "-b")] = None,
    body_file: Annotated[str | None, typer.Option("--body-file")] = None,
) -> None:
    """Add a comment to an issue (works for pull requests too)."""
    owner, name = split_repo(repo)
    text = _resolve_body(body, body_file)
    if not text:
        ctx.obj.out.error("Nothing to post: pass --body or --body-file.")
        raise typer.Exit(2)
    created = ctx.obj.github.issues.comment(owner, name, number, text)
    ctx.obj.out.success(f"comment added: {created.html_url}")


@app.command("comments")
@handle_errors
def comments(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    number: Annotated[int, typer.Argument()],
    limit: Annotated[int, typer.Option("--limit", "-n", min=1)] = 30,
) -> None:
    """List comments on an issue."""
    owner, name = split_repo(repo)
    rows = [
        {
            "author": c.user.login if c.user else "?",
            "created": c.created_at.strftime("%Y-%m-%d %H:%M") if c.created_at else "-",
            "body": (c.body or "").replace("\n", " "),
        }
        for c in ctx.obj.github.issues.comments(owner, name, number, max_items=limit)
    ]
    ctx.obj.out.rows(
        rows,
        columns=[("author", "Author"), ("created", "When"), ("body", "Comment")],
        empty="No comments.",
    )


@app.command("label")
@handle_errors
def label(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    number: Annotated[int, typer.Argument()],
    add: Annotated[str | None, typer.Option("--add", help="Comma separated labels to add.")] = None,
    remove: Annotated[str | None, typer.Option("--remove", help="Label to remove.")] = None,
) -> None:
    """Add or remove labels on an issue."""
    owner, name = split_repo(repo)
    gh = ctx.obj.github
    if not add and not remove:
        ctx.obj.out.error("Nothing to do: pass --add and/or --remove.")
        raise typer.Exit(2)
    if add:
        labels = [part.strip() for part in add.split(",") if part.strip()]
        result = gh.issues.add_labels(owner, name, number, labels)
        names = ", ".join(label.name for label in result)
        ctx.obj.out.success(f"labels now: {names or '(none)'}")
    if remove:
        gh.issues.remove_label(owner, name, number, remove)
        ctx.obj.out.success(f"removed {remove}")


def _resolve_body(body: str | None, body_file: str | None) -> str | None:
    if body_file:
        if body_file == "-":
            import sys

            return sys.stdin.read()
        with open(body_file, encoding="utf-8") as handle:
            return handle.read()
    return body

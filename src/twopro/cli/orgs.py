"""``2pro org`` - organisations, members and repositories."""

from __future__ import annotations

from typing import Annotated

import typer

from ._common import handle_errors

__all__ = ["app"]

app = typer.Typer(name="org", no_args_is_help=True, rich_markup_mode="rich")


@app.command("list")
@handle_errors
def list_orgs(ctx: typer.Context) -> None:
    """Organisations you belong to."""
    rows = [
        {"login": o.login, "name": o.name or "", "description": (o.description or "")[:60]}
        for o in ctx.obj.github.orgs.list_for_authenticated_user()
    ]
    ctx.obj.out.rows(
        rows,
        columns=[("login", "Login"), ("name", "Name"), ("description", "Description")],
        empty="No organisations.",
    )


@app.command("view")
@handle_errors
def view(ctx: typer.Context, org: Annotated[str, typer.Argument()]) -> None:
    """Show an organisation."""
    data = ctx.obj.github.orgs.get(org)
    ctx.obj.out.detail(
        {
            "login": data.login,
            "name": data.name or "",
            "description": data.description or "",
            "public_repos": data.public_repos,
            "url": data.html_url or "",
        },
        fields=[
            ("login", "Login"),
            ("name", "Name"),
            ("description", "Description"),
            ("public_repos", "Public repos"),
            ("url", "URL"),
        ],
        title=org,
    )


@app.command("repos")
@handle_errors
def repos(
    ctx: typer.Context,
    org: Annotated[str, typer.Argument()],
    limit: Annotated[int, typer.Option("--limit", "-n", min=1)] = 30,
) -> None:
    """Repositories in an organisation."""
    rows = [
        {
            "full_name": r.full_name,
            "stars": r.stargazers_count,
            "language": r.language or "-",
            "visibility": "private" if r.private else "public",
            "pushed": r.pushed_at.strftime("%Y-%m-%d") if r.pushed_at else "-",
        }
        for r in ctx.obj.github.orgs.repos(org, max_items=limit)
    ]
    ctx.obj.out.rows(
        rows,
        columns=[
            ("full_name", "Repository"),
            ("stars", "Stars"),
            ("language", "Language"),
            ("visibility", "Visibility"),
            ("pushed", "Last push"),
        ],
        empty="No repositories.",
    )


@app.command("members")
@handle_errors
def members(
    ctx: typer.Context,
    org: Annotated[str, typer.Argument()],
    role: Annotated[str, typer.Option("--role", help="all | admin | member")] = "all",
    limit: Annotated[int, typer.Option("--limit", "-n", min=1)] = 100,
) -> None:
    """Members of an organisation."""
    rows = [
        {"login": m.login, "type": m.type or ""}
        for m in ctx.obj.github.orgs.members(org, role=role, max_items=limit)
    ]
    ctx.obj.out.rows(
        rows, columns=[("login", "Login"), ("type", "Type")], empty="No members visible."
    )

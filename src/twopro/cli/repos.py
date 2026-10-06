"""``2pro repo`` - repositories, branches, releases, topics."""

from __future__ import annotations

from typing import Annotated

import typer

from ..client import guess_repo_path
from ._common import handle_errors, split_repo

__all__ = ["app"]

app = typer.Typer(name="repo", no_args_is_help=True, rich_markup_mode="rich")

REPO_COLUMNS = [
    ("full_name", "Repository"),
    ("stars", "Stars"),
    ("language", "Language"),
    ("open_issues", "Issues"),
    ("visibility", "Visibility"),
    ("pushed", "Last push"),
    ("archived", "Archived"),
]


def _row(repo) -> dict:
    return {
        "full_name": repo.full_name,
        "name": repo.name,
        "description": repo.description or "",
        "stars": repo.stargazers_count,
        "forks": repo.forks_count,
        "language": repo.language or "-",
        "open_issues": repo.open_issues_count,
        "visibility": "private" if repo.private else "public",
        "default_branch": repo.default_branch,
        "pushed": repo.pushed_at.strftime("%Y-%m-%d") if repo.pushed_at else "-",
        "archived": "yes" if repo.archived else "",
        "topics": ", ".join(repo.topics),
        "url": repo.html_url or "",
    }


@app.command("list")
@handle_errors
def list_repos(
    ctx: typer.Context,
    user: Annotated[
        str | None, typer.Option("--user", "-u", help="List a user's repositories.")
    ] = None,
    org: Annotated[
        str | None, typer.Option("--org", "-o", help="List an organisation's repositories.")
    ] = None,
    mine: Annotated[
        bool, typer.Option("--mine", help="Repositories you can see (default).")
    ] = False,
    limit: Annotated[int, typer.Option("--limit", "-n", min=1, help="Maximum rows to show.")] = 30,
    sort: Annotated[
        str, typer.Option("--sort", help="created | updated | pushed | full_name")
    ] = "updated",
    archived: Annotated[
        bool | None, typer.Option("--archived/--no-archived", help="Filter by archive state.")
    ] = None,
) -> None:
    """List repositories for a user, an organisation or yourself."""
    gh = ctx.obj.github
    if org:
        repos = gh.repos.list_for_org(org, sort=sort, max_items=limit * 3)
    elif user:
        repos = gh.repos.list_for_user(user, sort=sort, max_items=limit * 3)
    else:
        repos = gh.repos.list_for_authenticated_user(sort=sort, max_items=limit * 3)

    rows = []
    for repo in repos:
        if archived is not None and repo.archived != archived:
            continue
        rows.append(_row(repo))
        if len(rows) >= limit:
            break
    ctx.obj.out.rows(rows, columns=REPO_COLUMNS, empty="No repositories found.")


@app.command("view")
@handle_errors
def view(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument(help="owner/repo or a GitHub URL")],
) -> None:
    """Show one repository in detail."""
    owner, name = split_repo(repo)
    gh = ctx.obj.github
    data = _row(gh.repos.get(owner, name))
    data["Forks"] = data.pop("forks")
    ctx.obj.out.detail(
        data,
        fields=[
            ("full_name", "Repository"),
            ("description", "Description"),
            ("stars", "Stars"),
            ("Forks", "Forks"),
            ("open_issues", "Open issues"),
            ("language", "Language"),
            ("default_branch", "Default branch"),
            ("visibility", "Visibility"),
            ("pushed", "Last push"),
            ("topics", "Topics"),
            ("url", "URL"),
        ],
        title=repo,
    )


@app.command("create")
@handle_errors
def create(
    ctx: typer.Context,
    name: Annotated[str, typer.Argument(help="Repository name.")],
    org: Annotated[
        str | None, typer.Option("--org", "-o", help="Create in this organisation.")
    ] = None,
    description: Annotated[str | None, typer.Option("--description", "-d")] = None,
    private: Annotated[bool, typer.Option("--private/--public", help="Visibility.")] = False,
    auto_init: Annotated[
        bool, typer.Option("--init/--no-init", help="Create an initial commit.")
    ] = False,
    gitignore: Annotated[str | None, typer.Option("--gitignore", help="e.g. Python")] = None,
    license: Annotated[str | None, typer.Option("--license", help="e.g. mit")] = None,
) -> None:
    """Create a repository."""
    gh = ctx.obj.github
    repo = gh.repos.create(
        name,
        org=org,
        description=description,
        private=private,
        auto_init=auto_init,
        gitignore_template=gitignore,
        license_template=license,
    )
    ctx.obj.out.success(f"created {repo.full_name}")
    ctx.obj.out.detail(
        _row(repo),
        fields=[("full_name", "Repository"), ("url", "URL"), ("visibility", "Visibility")],
    )


@app.command("delete")
@handle_errors
def delete(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    yes: Annotated[bool, typer.Option("--yes", "-y", help="Skip the confirmation prompt.")] = False,
) -> None:
    """Delete a repository (irreversible)."""
    owner, name = split_repo(repo)
    if not yes and not typer.confirm(f"Delete {owner}/{name}? This cannot be undone"):
        raise typer.Abort()
    ctx.obj.github.repos.delete(owner, name)
    ctx.obj.out.success(f"deleted {owner}/{name}")


@app.command("branches")
@handle_errors
def branches(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    limit: Annotated[int, typer.Option("--limit", "-n", min=1)] = 30,
) -> None:
    """List branches."""
    owner, name = split_repo(repo)
    rows = [
        {"name": b.name, "sha": (b.sha or "")[:8], "protected": "yes" if b.protected else ""}
        for b in list(ctx.obj.github.repos.branches(owner, name, max_items=limit))
    ]
    ctx.obj.out.rows(
        rows,
        columns=[("name", "Branch"), ("sha", "Commit"), ("protected", "Protected")],
        empty="No branches found.",
    )


@app.command("releases")
@handle_errors
def releases(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    limit: Annotated[int, typer.Option("--limit", "-n", min=1)] = 20,
) -> None:
    """List releases."""
    owner, name = split_repo(repo)
    rows = [
        {
            "tag": r.tag_name,
            "name": r.name or "",
            "draft": "draft" if r.draft else ("pre" if r.prerelease else "release"),
            "published": r.published_at.strftime("%Y-%m-%d") if r.published_at else "-",
            "assets": len(r.assets),
            "url": r.html_url or "",
        }
        for r in list(ctx.obj.github.repos.releases(owner, name, max_items=limit))
    ]
    ctx.obj.out.rows(
        rows,
        columns=[
            ("tag", "Tag"),
            ("name", "Name"),
            ("draft", "Kind"),
            ("published", "Published"),
            ("assets", "Assets"),
        ],
        empty="No releases yet.",
    )


@app.command("topics")
@handle_errors
def topics(ctx: typer.Context, repo: Annotated[str, typer.Argument()]) -> None:
    """Show repository topics."""
    owner, name = split_repo(repo)
    names = ctx.obj.github.repos.topics(owner, name)
    ctx.obj.out.rows(
        [{"topic": n} for n in names], columns=[("topic", "Topic")], empty="No topics."
    )


@app.command("readme")
@handle_errors
def readme(ctx: typer.Context, repo: Annotated[str, typer.Argument()]) -> None:
    """Print the README."""
    owner, name = split_repo(repo)
    text = ctx.obj.github.repos.readme(owner, name)
    if text is None:
        ctx.obj.out.warn("no README found")
        raise typer.Exit(1)
    ctx.obj.out.value(text)


@app.command("search")
@handle_errors
def search(
    ctx: typer.Context,
    query: Annotated[str, typer.Argument(help="e.g. 'language:python stars:>1000'")],
    limit: Annotated[int, typer.Option("--limit", "-n", min=1)] = 20,
) -> None:
    """Search repositories (search API: 30 requests/minute)."""
    rows = [_row(r) for r in list(ctx.obj.github.search.repositories(query, max_items=limit))]
    ctx.obj.out.rows(rows, columns=REPO_COLUMNS, empty="No repositories matched.")


@app.command("open")
@handle_errors
def open_repo(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument(help="owner/repo, or omit to use the current directory.")],
) -> None:
    """Print the repository URL (or open it with --browser)."""
    owner, name = split_repo(repo)
    ctx.obj.out.value(f"https://github.com/{owner}/{name}")


def _current_repo() -> str | None:  # pragma: no cover - git dependent
    import subprocess

    try:
        url = subprocess.check_output(
            ["git", "config", "--get", "remote.origin.url"], text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (OSError, subprocess.SubprocessError):
        return None
    if not url:
        return None
    try:
        owner, name = guess_repo_path(url)
    except ValueError:
        return None
    return f"{owner}/{name}"

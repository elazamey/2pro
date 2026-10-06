"""``2pro automate`` - the repo-automation helpers as a CLI.

Designed for GitHub Actions: everything defaults to a dry run, prints markdown
(so you can pipe it into ``$GITHUB_STEP_SUMMARY``) and exits non-zero when it
finds something that needs a human.
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ..automation import (
    build_digest,
    label_pr,
    review_pr,
    sweep_stale,
)
from ._common import handle_errors, split_repo

__all__ = ["app"]

app = typer.Typer(name="automate", no_args_is_help=True, rich_markup_mode="rich")

DryRun = Annotated[
    bool,
    typer.Option(
        "--dry-run/--apply",
        help="Preview the changes (default) or actually write them.",
    ),
]


def _emit(ctx: typer.Context, markdown: str, out: str | None, summary: bool) -> None:
    if out:
        Path(out).write_text(markdown + "\n", encoding="utf-8")
        ctx.obj.out.success(f"wrote {out}")
    else:
        ctx.obj.out.value(markdown)
    if summary:
        summary_path = _github_summary()
        if summary_path:
            with open(summary_path, "a", encoding="utf-8") as handle:
                handle.write(markdown + "\n")
            ctx.obj.out.message(f"appended to {summary_path}", style="dim")


def _github_summary() -> str | None:  # pragma: no cover - environment dependent
    import os

    return os.environ.get("GITHUB_STEP_SUMMARY")


@app.command("label")
@handle_errors
def label(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument(help="owner/repo")],
    number: Annotated[int, typer.Argument(help="Pull request number.")],
    dry_run: DryRun = True,
    create_missing: Annotated[
        bool, typer.Option("--create-missing", help="Apply labels that do not exist yet.")
    ] = False,
    add: Annotated[str | None, typer.Option("--add", help="Extra labels, comma separated.")] = None,
) -> None:
    """Suggest and apply conventional-commit / size labels to a pull request."""
    owner, name = split_repo(repo)
    extra = [p.strip() for p in (add or "").split(",") if p.strip()]
    report = label_pr(
        ctx.obj.github,
        f"{owner}/{name}",
        number,
        dry_run=dry_run,
        create_missing=create_missing,
        extra=extra,
    )
    _emit(ctx, report.markdown, None, True)
    if dry_run and report.suggested:
        ctx.obj.out.message("dry run - re-run with --apply to write the labels", style="dim")


@app.command("stale")
@handle_errors
def stale(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    days: Annotated[int, typer.Option("--days", help="Idle days before marking stale.")] = 60,
    close_days: Annotated[
        int, typer.Option("--close-days", help="Days after the stale label before closing.")
    ] = 14,
    label_name: Annotated[str, typer.Option("--label", help="Stale label name.")] = "stale",
    limit: Annotated[int | None, typer.Option("--limit", help="Stop after N issues.")] = None,
    dry_run: DryRun = True,
    out: Annotated[
        str | None, typer.Option("--out", "-o", help="Write markdown to a file.")
    ] = None,
) -> None:
    """Mark inactive issues stale and close the ones that stayed stale."""
    report = sweep_stale(
        ctx.obj.github,
        repo,
        stale_days=days,
        close_days=close_days,
        stale_label=label_name,
        limit=limit,
        dry_run=dry_run,
    )
    _emit(ctx, report.markdown, out, True)


@app.command("digest")
@handle_errors
def digest(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    days: Annotated[int, typer.Option("--days", help="Window size in days.")] = 7,
    out: Annotated[
        str | None, typer.Option("--out", "-o", help="Write markdown to a file.")
    ] = None,
    stdout: Annotated[bool, typer.Option("--stdout", help="Print the markdown.")] = True,
) -> None:
    """Build a markdown activity digest (merged PRs, issues, CI, contributors)."""
    report = build_digest(ctx.obj.github, repo, days=days)
    if stdout or not out:
        ctx.obj.out.value(report.markdown)
    if out:
        Path(out).write_text(report.markdown + "\n", encoding="utf-8")
        ctx.obj.out.success(f"wrote {out}")
    _emit_summary(report.markdown)


@app.command("review")
@handle_errors
def review(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    number: Annotated[int, typer.Argument(help="Pull request number.")],
    post: Annotated[bool, typer.Option("--post", help="Post the review as a comment.")] = False,
    dry_run: DryRun = True,
    out: Annotated[str | None, typer.Option("--out", "-o")] = None,
    fail_on_error: Annotated[
        bool, typer.Option("--fail-on-error/--no-fail-on-error", help="Exit 1 on blocker findings.")
    ] = True,
) -> None:
    """Run the automated review checklist over a pull request."""
    report = review_pr(ctx.obj.github, repo, number, post=post, dry_run=dry_run)
    _emit(ctx, report.markdown, out, True)
    if report.posted:
        ctx.obj.out.success(f"review posted on #{number}")
    if fail_on_error and report.errors:
        raise typer.Exit(1)


def _emit_summary(markdown: str) -> None:  # pragma: no cover - environment dependent
    path = _github_summary()
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(markdown + "\n")

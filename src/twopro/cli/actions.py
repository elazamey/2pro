"""``2pro run`` / ``2pro workflow`` - GitHub Actions from the terminal."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Annotated

import typer

from ._common import handle_errors, human_delta, split_repo

__all__ = ["app", "workflow_app"]

app = typer.Typer(name="run", no_args_is_help=True, rich_markup_mode="rich")
workflow_app = typer.Typer(name="workflow", no_args_is_help=True, rich_markup_mode="rich")

RUN_COLUMNS = [
    ("id", "Run id"),
    ("workflow", "Workflow"),
    ("event", "Event"),
    ("branch", "Branch"),
    ("status", "Status"),
    ("conclusion", "Result"),
    ("duration", "Duration"),
    ("created", "Started"),
]


def _row(run) -> dict:
    return {
        "id": run.id,
        "run_number": run.run_number,
        "workflow": run.name or run.workflow_name or "-",
        "event": run.event or "-",
        "branch": run.head_branch or "-",
        "status": f"{run.icon} {run.status or '?'}",
        "conclusion": run.conclusion or "",
        "duration": human_delta(run.duration_seconds),
        "created": run.created_at.strftime("%Y-%m-%d %H:%M") if run.created_at else "-",
        "url": run.html_url or "",
        "actor": run.actor.login if run.actor else "-",
    }


@app.command("list")
@handle_errors
def list_runs(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument(help="owner/repo")],
    workflow: Annotated[
        str | None, typer.Option("--workflow", "-w", help="Workflow file or id.")
    ] = None,
    branch: Annotated[str | None, typer.Option("--branch", "-b")] = None,
    event: Annotated[
        str | None, typer.Option("--event", help="push, pull_request, schedule...")
    ] = None,
    status: Annotated[
        str | None, typer.Option("--status", help="queued | in_progress | completed")
    ] = None,
    actor: Annotated[str | None, typer.Option("--actor")] = None,
    limit: Annotated[int, typer.Option("--limit", "-n", min=1)] = 20,
) -> None:
    """List workflow runs, newest first."""
    owner, name = split_repo(repo)
    runs = ctx.obj.github.actions.runs(
        owner,
        name,
        workflow_id=workflow,
        branch=branch,
        event=event,
        status=status,
        actor=actor,
        max_items=limit,
    )
    ctx.obj.out.rows([_row(r) for r in runs], columns=RUN_COLUMNS, empty="No workflow runs.")


@app.command("view")
@handle_errors
def view(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    run_id: Annotated[int, typer.Argument()],
    jobs: Annotated[
        bool, typer.Option("--jobs", "-j", help="Also list the jobs in the run.")
    ] = False,
) -> None:
    """Show one workflow run (and optionally its jobs)."""
    owner, name = split_repo(repo)
    gh = ctx.obj.github
    run = gh.actions.run(owner, name, run_id)
    ctx.obj.out.detail(
        _row(run),
        fields=[
            ("id", "Run id"),
            ("workflow", "Workflow"),
            ("event", "Event"),
            ("branch", "Branch"),
            ("status", "Status"),
            ("conclusion", "Result"),
            ("duration", "Duration"),
            ("actor", "Actor"),
            ("created", "Started"),
            ("url", "URL"),
        ],
        title=f"run {run_id}",
    )
    if jobs:
        rows = [
            {
                "name": j.name,
                "status": f"{j.icon} {j.status or ''}",
                "conclusion": j.conclusion or "",
                "duration": human_delta(j.duration_seconds),
            }
            for j in gh.actions.jobs(owner, name, run_id)
        ]
        ctx.obj.out.rows(
            rows,
            columns=[
                ("name", "Job"),
                ("status", "Status"),
                ("conclusion", "Result"),
                ("duration", "Duration"),
            ],
            empty="No jobs in this run.",
        )


@app.command("watch")
@handle_errors
def watch(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    run_id: Annotated[int, typer.Argument()],
    interval: Annotated[
        float, typer.Option("--interval", "-i", help="Poll every N seconds.")
    ] = 15.0,
    timeout: Annotated[float, typer.Option("--timeout", help="Give up after N seconds.")] = 3600.0,
) -> None:
    """Follow a run until it finishes, then print the job summary."""
    owner, name = split_repo(repo)
    gh = ctx.obj.github
    sleep = ctx.obj.sleep or time.sleep
    started = time.monotonic()

    while True:
        run = gh.actions.run(owner, name, run_id)
        ctx.obj.out.message(
            f"{run.icon} {run.label[:60]} - {run.status}"
            f"{('/' + run.conclusion) if run.conclusion else ''}"
        )
        if run.is_completed:
            break
        if time.monotonic() - started > timeout:
            ctx.obj.out.warn(f"still {run.status} after {timeout:.0f}s - giving up")
            raise typer.Exit(1)
        sleep(interval)

    rows = [
        {
            "name": j.name,
            "status": f"{j.icon} {j.status or ''}",
            "conclusion": j.conclusion or "",
            "duration": human_delta(j.duration_seconds),
        }
        for j in gh.actions.jobs(owner, name, run_id)
    ]
    ctx.obj.out.rows(
        rows,
        columns=[
            ("name", "Job"),
            ("status", "Status"),
            ("conclusion", "Result"),
            ("duration", "Duration"),
        ],
        empty="No jobs in this run.",
    )
    if run.is_failure:
        raise typer.Exit(1)


@app.command("rerun")
@handle_errors
def rerun(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    run_id: Annotated[int, typer.Argument()],
    failed: Annotated[bool, typer.Option("--failed", help="Only re-run the failed jobs.")] = False,
) -> None:
    """Re-run a workflow run."""
    owner, name = split_repo(repo)
    ctx.obj.github.actions.rerun(owner, name, run_id, failed_only=failed)
    ctx.obj.out.success(
        f"re-run requested for {run_id}" + (" (failed jobs only)" if failed else "")
    )


@app.command("cancel")
@handle_errors
def cancel(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    run_id: Annotated[int, typer.Argument()],
) -> None:
    """Cancel a running workflow run."""
    owner, name = split_repo(repo)
    ctx.obj.github.actions.cancel(owner, name, run_id)
    ctx.obj.out.success(f"cancel requested for {run_id}")


@app.command("logs")
@handle_errors
def logs(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    run_id: Annotated[int, typer.Argument()],
    job_id: Annotated[int | None, typer.Option("--job", help="Fetch a single job's log.")] = None,
    out: Annotated[
        str | None, typer.Option("--out", "-o", help="Write to this file instead of the default.")
    ] = None,
    stdout: Annotated[bool, typer.Option("--stdout", help="Print job logs to stdout.")] = False,
) -> None:
    """Download run logs (a zip) or a single job's log (text)."""
    owner, name = split_repo(repo)
    gh = ctx.obj.github

    if job_id:
        text = gh.actions.job_logs(owner, name, job_id).decode("utf-8", "replace")
        if stdout or not out:
            ctx.obj.out.value(text)
        else:
            Path(out).write_text(text, encoding="utf-8")
            ctx.obj.out.success(f"wrote {out}")
        return

    blob = gh.actions.logs(owner, name, run_id)
    target = Path(out or f"{name}-{run_id}-logs.zip")
    target.write_bytes(blob)
    ctx.obj.out.success(f"wrote {target} ({len(blob) / 1024:.0f} KiB)")


@app.command("artifacts")
@handle_errors
def artifacts(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    run_id: Annotated[int, typer.Argument()],
    download: Annotated[
        str | None,
        typer.Option("--download", "-d", help="Download every artifact into this directory."),
    ] = None,
) -> None:
    """List artifacts of a run, optionally downloading them."""
    owner, name = split_repo(repo)
    gh = ctx.obj.github
    found = list(gh.actions.artifacts(owner, name, run_id))
    rows = [
        {"id": a.id, "name": a.name, "size": a.size_human, "expired": "yes" if a.expired else ""}
        for a in found
    ]
    ctx.obj.out.rows(
        rows,
        columns=[("id", "Id"), ("name", "Name"), ("size", "Size"), ("expired", "Expired")],
        empty="No artifacts for this run.",
    )

    if download:
        destination = Path(download)
        destination.mkdir(parents=True, exist_ok=True)
        for artifact in found:
            blob = gh.actions.download_artifact(owner, name, artifact.id)
            (destination / f"{artifact.name}.zip").write_bytes(blob)
            ctx.obj.out.success(f"{artifact.name}.zip ({len(blob) / 1024:.0f} KiB)")


@app.command("dispatch")
@handle_errors
def dispatch(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    workflow: Annotated[str, typer.Argument(help="Workflow file name or id, e.g. ci.yml")],
    ref: Annotated[str, typer.Option("--ref", help="Branch or tag to run on.")] = "main",
    inputs: Annotated[
        list[str] | None, typer.Option("--input", help="key=value (repeatable).")
    ] = None,
) -> None:
    """Trigger a workflow_dispatch run."""
    owner, name = split_repo(repo)
    parsed = {}
    for item in inputs or []:
        key, _, value = item.partition("=")
        parsed[key] = value
    ctx.obj.github.actions.dispatch(owner, name, workflow, ref=ref, inputs=parsed)
    ctx.obj.out.success(f"dispatched {workflow} on {ref}" + (f" with {parsed}" if parsed else ""))


@workflow_app.command("list")
@handle_errors
def workflow_list(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument()],
    limit: Annotated[int, typer.Option("--limit", "-n", min=1)] = 30,
) -> None:
    """List the workflows defined in a repository."""
    owner, name = split_repo(repo)
    rows = [
        {"id": w.id, "name": w.name, "path": w.path or "", "state": w.state or ""}
        for w in ctx.obj.github.actions.workflows(owner, name, max_items=limit)
    ]
    ctx.obj.out.rows(
        rows,
        columns=[("id", "Id"), ("name", "Name"), ("path", "Path"), ("state", "State")],
        empty="No workflows found.",
    )

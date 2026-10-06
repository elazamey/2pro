"""The ``2pro`` command: root options, the dashboard server and shortcuts."""

from __future__ import annotations

import os
from typing import Annotated

import typer

from .._version import __version__
from ._common import AppContext, handle_errors
from .output import OutputFormat

__all__ = ["app"]

HELP = """
[bold]2pro[/bold] - one toolkit for GitHub: read and write repositories,
issues, pull requests and Actions runs, from the terminal, from Python or
from a live dashboard.

[dim]Auth is resolved automatically from GITHUB_TOKEN, `2pro auth login` or the
GitHub CLI.[/dim]
"""

EPILOG = """
[bold]Examples[/bold]
  2pro auth status                     # who am I and how many calls are left
  2pro repo list --mine --limit 20
  2pro issue list elazamey/2pro --state open
  2pro pr checks elazamey/2pro 3
  2pro run watch elazamey/2pro 123456  # follow a workflow run
  2pro serve                           # open the dashboard
"""

app = typer.Typer(
    name="2pro",
    help=HELP,
    epilog=EPILOG,
    no_args_is_help=True,
    rich_markup_mode="rich",
    add_completion=True,
)


def _version_callback(value: bool) -> None:
    if value:
        typer.echo(f"2pro {__version__}")
        raise typer.Exit()


@app.callback(invoke_without_command=True)
def main(
    ctx: typer.Context,
    token: Annotated[
        str | None,
        typer.Option("--token", "-t", help="GitHub token (default: env / gh CLI / stored)."),
    ] = None,
    hostname: Annotated[
        str | None,
        typer.Option("--hostname", help="GitHub Enterprise hostname, e.g. github.example.com."),
    ] = None,
    fmt: Annotated[
        OutputFormat,
        typer.Option("--format", "-f", help="Output format: table, json, yaml or csv."),
    ] = OutputFormat.TABLE,
    no_color: Annotated[
        bool, typer.Option("--no-color", help="Disable colours and other ANSI styling.")
    ] = False,
    verbose: Annotated[
        bool, typer.Option("--verbose", "-v", help="Print request errors with more detail.")
    ] = False,
    version: Annotated[
        bool,
        typer.Option(
            "--version",
            "-V",
            callback=_version_callback,
            is_eager=True,
            help="Show the 2pro version and exit.",
        ),
    ] = False,
) -> None:
    """Set up the shared context for every subcommand."""
    ctx.obj = AppContext(
        token=token,
        hostname=hostname,
        fmt=fmt,
        color=not no_color,
        verbose=verbose,
    )
    if ctx.invoked_subcommand is None:
        typer.echo(ctx.get_help())


@app.command("me")
@handle_errors
def me(ctx: typer.Context) -> None:
    """Show the authenticated user."""
    gh = ctx.obj.github
    user = gh.me()
    ctx.obj.out.detail(
        user,
        fields=[
            ("login", "Login"),
            ("name", "Name"),
            ("public_repos", "Public repos"),
            ("followers", "Followers"),
            ("created_at", "Member since"),
        ],
        title="Authenticated user",
    )


@app.command("rate-limit")
@handle_errors
def rate_limit(ctx: typer.Context, refresh: bool = True) -> None:
    """Remaining API budget for this token."""
    gh = ctx.obj.github
    rl = gh.rate_limit(refresh=refresh)
    ctx.obj.out.status_line(
        [
            ("Remaining", f"{rl.remaining} / {rl.limit}"),
            ("Used", f"{rl.used} ({rl.used_ratio:.0%})"),
            ("Resets at", f"{rl.reset_at:%Y-%m-%d %H:%M:%S %Z}" if rl.reset_at else "-"),
            ("Resets in", f"{int(rl.seconds_until_reset)}s"),
        ]
    )


@app.command("serve")
@handle_errors
def serve(
    ctx: typer.Context,
    host: Annotated[
        str, typer.Option("--host", help="Bind address (0.0.0.0 exposes it on your network).")
    ] = os.environ.get("TWOPRO_HOST", "0.0.0.0"),
    port: Annotated[int, typer.Option("--port", "-p", help="Port to listen on.")] = int(
        os.environ.get("TWOPRO_PORT", "8000")
    ),
    open_browser: Annotated[
        bool, typer.Option("--open/--no-open", help="Try to open a browser after startup.")
    ] = False,
) -> None:
    """Run the 2pro dashboard (FastAPI + a zero-build web UI)."""
    import threading
    import webbrowser

    import uvicorn

    from ..web import create_app

    token = ctx.obj.token
    web_app = create_app(token=token)

    if open_browser:
        threading.Timer(1.5, lambda: webbrowser.open(f"http://localhost:{port}")).start()

    typer.echo(f"2pro dashboard → http://{host}:{port}  (Ctrl+C to stop)")
    uvicorn.run(web_app, host=host, port=port, log_level="info")


@app.command("graphql")
@handle_errors
def graphql(
    ctx: typer.Context,
    query: Annotated[str, typer.Argument(help="GraphQL query string.")],
    var: Annotated[
        list[str] | None,
        typer.Option("--var", help="Variables as key=value (repeatable)."),
    ] = None,
) -> None:
    """Run an arbitrary GraphQL query (the escape hatch for anything missing)."""
    variables: dict[str, object] = {}
    for item in var or []:
        key, _, value = item.partition("=")
        variables[key] = value
    result = ctx.obj.github.client.graphql(query, variables, raise_on_error=False)
    ctx.obj.out.value(result.data if result.ok else {"errors": result.errors})


# --------------------------------------------------------------------------- #
# Sub-applications
# --------------------------------------------------------------------------- #

from . import actions as _actions  # noqa: E402
from . import auth as _auth  # noqa: E402
from . import automate as _automate  # noqa: E402
from . import issues as _issues  # noqa: E402
from . import orgs as _orgs  # noqa: E402
from . import pulls as _pulls  # noqa: E402
from . import repos as _repos  # noqa: E402

app.add_typer(_auth.app, name="auth", help="Inspect and create credentials.")
app.add_typer(_repos.app, name="repo", help="Repositories, branches, releases and topics.")
app.add_typer(_issues.app, name="issue", help="List, create, close and comment on issues.")
app.add_typer(_pulls.app, name="pr", help="Pull requests: checks, reviews, merge.")
app.add_typer(_actions.app, name="run", help="Actions runs: watch, re-run, logs, artifacts.")
app.add_typer(_actions.workflow_app, name="workflow", help="Actions workflows in a repository.")
app.add_typer(_orgs.app, name="org", help="Organisations, members and repositories.")
app.add_typer(_automate.app, name="automate", help="Repo automation for CI: labels, stale, digest.")

"""``2pro auth`` - inspect, create and remove credentials."""

from __future__ import annotations

import os
from typing import Annotated

import typer

from .. import auth as auth_lib
from ._common import handle_errors

__all__ = ["app"]

app = typer.Typer(name="auth", no_args_is_help=True, rich_markup_mode="rich")


@app.command("status")
@handle_errors
def status(ctx: typer.Context) -> None:
    """Where the token comes from, who it belongs to, and the budget left."""
    gh = ctx.obj.github
    out = ctx.obj.out
    cred = gh.credential

    response = gh.client.request("GET", "/", raw=True)
    scopes = response.headers.get("x-oauth-scopes") or "(none / fine-grained token)"
    rl = gh.rate_limit()

    try:
        user = gh.users.me()
        login = user.login
        name = user.name or ""
    except Exception:
        login, name = "(unknown)", ""

    out.status_line(
        [
            ("Host", gh.settings.hostname),
            ("Authenticated as", f"{login}{(' - ' + name) if name else ''}"),
            ("Token", auth_lib.mask_token(cred.token) if cred else "(none)"),
            ("Source", cred.source.value if cred else "(none)"),
            ("Detail", cred.detail if cred else "-"),
            ("Scopes", scopes),
            (
                "Rate limit",
                f"{rl.remaining}/{rl.limit} left, resets in {int(rl.seconds_until_reset)}s",
            ),
            ("Requests made", gh.client.request_count),
        ]
    )


@app.command("token")
@handle_errors
def token(
    ctx: typer.Context,
    show: Annotated[
        bool, typer.Option("--show", help="Print the token in full (careful with shell history).")
    ] = False,
) -> None:
    """Print the resolved token (masked unless --show)."""
    gh = ctx.obj.github
    cred = gh.credential
    if not cred:
        ctx.obj.out.error("No credential available.")
        raise typer.Exit(1)
    value = cred.token if show else auth_lib.mask_token(cred.token)
    if show and ctx.obj.output.console.is_terminal:
        ctx.obj.out.warn("printing a secret to the terminal")
    ctx.obj.out.value(value)


@app.command("whoami")
@handle_errors
def whoami(ctx: typer.Context) -> None:
    """Just the login - handy in shell scripts."""
    ctx.obj.out.value(ctx.obj.github.users.me().login)


@app.command("login")
@handle_errors
def login(
    ctx: typer.Context,
    client_id: Annotated[
        str | None,
        typer.Option(
            "--client-id",
            envvar="TWOPRO_OAUTH_CLIENT_ID",
            help="OAuth App client id (device flow).",
        ),
    ] = None,
    scope: Annotated[str, typer.Option("--scope", help="Space separated scopes.")] = " ".join(
        auth_lib.DEFAULT_SCOPES
    ),
    store: Annotated[
        bool, typer.Option("--store/--no-store", help="Save the token under ~/.config/2pro.")
    ] = True,
    timeout: Annotated[
        float, typer.Option("--timeout", help="Stop waiting after this many seconds.")
    ] = 600.0,
) -> None:
    """Log in with the OAuth device flow (needs only an OAuth App client id)."""
    if not client_id:
        ctx.obj.out.error(
            "A client id is required: 2pro auth login --client-id Iv1.xxxx  "
            "(or set TWOPRO_OAUTH_CLIENT_ID)"
        )
        raise typer.Exit(1)

    flow = auth_lib.start_device_flow(client_id, scope, hostname=ctx.obj.hostname or "github.com")
    ctx.obj.out.message(flow.instructions, style="bold")
    ctx.obj.out.message("waiting for approval...", style="dim")

    credential = auth_lib.poll_for_token(
        flow,
        hostname=ctx.obj.hostname or "github.com",
        sleep=ctx.obj.sleep or _real_sleep,
        max_wait=timeout,
    )

    ctx.obj.token = credential.token
    ctx.obj._github = None  # rebuild the client with the new credential
    user = ctx.obj.github.users.me()

    if store:
        path = auth_lib.save_token(credential.token, source=credential.source)
        ctx.obj.out.success(f"token stored in {path}")

    ctx.obj.out.status_line(
        [
            ("Logged in as", user.login),
            ("Scopes", scope),
            ("Token", auth_lib.mask_token(credential.token)),
        ]
    )


@app.command("logout")
@handle_errors
def logout(ctx: typer.Context) -> None:
    """Delete the token stored by ``2pro auth login``."""
    if auth_lib.clear_stored_token():
        ctx.obj.out.success("stored token removed")
    else:
        ctx.obj.out.message("no stored token to remove")


@app.command("test")
@handle_errors
def test(ctx: typer.Context) -> None:
    """Make one real call and report what the credential can do."""
    gh = ctx.obj.github
    user = gh.users.me()
    rl = gh.rate_limit(refresh=True)
    ctx.obj.out.status_line(
        [
            ("Connectivity", "ok"),
            ("User", user.login),
            ("Rate limit", f"{rl.remaining}/{rl.limit}"),
            ("Token", auth_lib.mask_token(gh.credential.token if gh.credential else None)),
        ]
    )
    if os.environ.get("GITHUB_ACTIONS") == "true":
        ctx.obj.out.message("running inside GitHub Actions", style="dim")


def _real_sleep(seconds: float) -> None:  # pragma: no cover - thin wrapper
    import time

    time.sleep(seconds)

"""Shared CLI plumbing: context object, reusable options and helpers."""

from __future__ import annotations

import functools
from collections.abc import Callable
from typing import Any

import typer

from ..client import guess_repo_path
from ..errors import GitHubError, TwoProError
from ..github import GitHub
from .output import Output, OutputFormat

__all__ = [
    "AppContext",
    "FormatOption",
    "LimitOption",
    "TokenOption",
    "handle_errors",
    "human_delta",
    "split_repo",
]

TokenOption = str | None
FormatOption = OutputFormat
LimitOption = int


class AppContext:
    """Everything a command needs, built lazily by the root callback."""

    def __init__(
        self,
        *,
        token: str | None = None,
        hostname: str | None = None,
        fmt: OutputFormat = OutputFormat.TABLE,
        color: bool = True,
        verbose: bool = False,
        sleep: Any = None,
        transport: Any = None,
    ) -> None:
        self.token = token
        self.hostname = hostname
        self.verbose = verbose
        self.sleep = sleep
        self.transport = transport
        self.output = Output(fmt=fmt, color=color)
        self._github: GitHub | None = None
        self._error: str | None = None

    @property
    def fmt(self) -> OutputFormat:
        return self.output.fmt

    @property
    def out(self) -> Output:
        return self.output

    @property
    def github(self) -> GitHub:
        """The shared :class:`~twopro.GitHub` instance (created on first use)."""
        if self._github is None:
            try:
                self._github = GitHub(
                    self.token,
                    transport=self.transport,
                    sleep=self.sleep,
                    **({"hostname": self.hostname} if self.hostname else {}),
                )
            except TwoProError as exc:
                self._error = str(exc)
                raise
        return self._github


def split_repo(value: str) -> tuple[str, str]:
    """Split ``owner/repo`` (or a GitHub URL) with a friendly error message."""
    try:
        return guess_repo_path(value)
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc


def human_delta(seconds: float | None) -> str:
    """``7541`` becomes ``2h 5m``."""
    if seconds is None:
        return "-"
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds}s"
    minutes, sec = divmod(seconds, 60)
    if minutes < 60:
        return f"{minutes}m {sec:02d}s"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours}h {minutes:02d}m"
    days, hours = divmod(hours, 24)
    return f"{days}d {hours:02d}h"


def handle_errors(func: Callable[..., Any]) -> Callable[..., Any]:
    """Turn 2pro exceptions into a one-line error plus exit code 1."""

    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        ctx: typer.Context | None = None
        for arg in args:
            if isinstance(arg, typer.Context):
                ctx = arg
                break
        ctx = ctx or kwargs.get("ctx")
        try:
            return func(*args, **kwargs)
        except typer.Exit:
            raise
        except typer.Abort:
            raise
        except TwoProError as exc:
            console = ctx.obj.out if ctx and isinstance(ctx.obj, AppContext) else Output()
            console.error(str(exc))
            if isinstance(exc, GitHubError) and exc.documentation_url:
                console.message(f"docs: {exc.documentation_url}", style="dim")
            raise typer.Exit(1) from exc

    return wrapper

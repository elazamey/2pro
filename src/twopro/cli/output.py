"""Rendering helpers shared by every CLI command.

Every command can emit ``table`` (default, human friendly), ``json``, ``yaml``
or ``csv`` so the same command works at the terminal and inside a pipeline.
"""

from __future__ import annotations

import csv
import io
import json
from collections.abc import Iterable, Mapping, Sequence
from enum import Enum
from typing import Any

import yaml
from pydantic import BaseModel
from rich.console import Console
from rich.table import Table

__all__ = ["Output", "OutputFormat", "to_primitive", "truncate"]

MAX_CELL = 60


class OutputFormat(str, Enum):
    """Supported rendering formats."""

    TABLE = "table"
    JSON = "json"
    YAML = "yaml"
    CSV = "csv"

    def __str__(self) -> str:  # pragma: no cover - cosmetic
        return self.value


def to_primitive(value: Any) -> Any:
    """Convert models / datetimes / enums into JSON-serialisable values."""
    if isinstance(value, BaseModel):
        return json.loads(value.model_dump_json())
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, Mapping):
        return {str(k): to_primitive(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_primitive(v) for v in value]
    return str(value)


def truncate(text: Any, width: int = MAX_CELL) -> str:
    value = "" if text is None else str(text)
    value = value.replace("\r\n", " ").replace("\n", " ").replace("\t", " ")
    return value if len(value) <= width else value[: width - 1] + "…"


def _rows_as_dicts(rows: Iterable[Any], columns: Sequence[str] | None) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    for row in rows:
        data = to_primitive(row)
        if not isinstance(data, dict):
            data = {"value": data}
        if columns:
            data = {key: data.get(key) for key in columns}
        prepared.append(data)
    return prepared


def _normalise_columns(
    columns: Sequence[Any] | None, sample: Mapping[str, Any]
) -> list[tuple[str, str]]:
    if columns:
        out: list[tuple[str, str]] = []
        for col in columns:
            if isinstance(col, (tuple, list)) and len(col) == 2:
                out.append((str(col[0]), str(col[1])))
            else:
                out.append((str(col), str(col).replace("_", " ").title()))
        return out
    return [(key, key.replace("_", " ").title()) for key in sample]


class Output:
    """Format-aware printer used through ``ctx.obj``."""

    def __init__(
        self,
        fmt: OutputFormat = OutputFormat.TABLE,
        *,
        color: bool = True,
        quiet: bool = False,
    ) -> None:
        self.fmt = fmt
        self.quiet = quiet
        self.console = Console(color_system="auto" if color else None, soft_wrap=True)
        self.err_console = Console(
            stderr=True, color_system="auto" if color else None, soft_wrap=True
        )

    # --------------------------------------------------------------- printing

    def rows(
        self,
        rows: Iterable[Any],
        *,
        columns: Sequence[Any] | None = None,
        title: str | None = None,
        empty: str = "Nothing to show.",
    ) -> None:
        """Render a list of models or dicts."""
        data = _rows_as_dicts(rows, None)
        if not data:
            if not self.quiet:
                self.err_console.print(f"[dim]{empty}[/dim]")
            return

        # Machine formats keep every field; the table/csv views honour `columns`.
        if self.fmt is OutputFormat.JSON:
            self.console.print_json(json.dumps(data, default=str))
            return
        if self.fmt is OutputFormat.YAML:
            self.console.print(
                yaml.safe_dump(data, sort_keys=False, default_flow_style=False).rstrip()
            )
            return

        headers = _normalise_columns(columns, data[0])
        subset = [{key: row.get(key) for key, _ in headers} for row in data]

        if self.fmt is OutputFormat.CSV:
            buffer = io.StringIO()
            writer = csv.DictWriter(buffer, fieldnames=[key for key, _ in headers])
            writer.writeheader()
            writer.writerows(subset)
            self.console.print(buffer.getvalue().rstrip())
            return
        table = Table(title=title, header_style="bold cyan", box=None, pad_edge=False)
        for _, header in headers:
            table.add_column(header, overflow="ellipsis", no_wrap=True)
        for row in subset:
            table.add_row(*(truncate(row.get(key)) for key, _ in headers))
        self.console.print(table)

    def detail(
        self,
        obj: Any,
        *,
        fields: Sequence[Any] | None = None,
        title: str | None = None,
    ) -> None:
        """Render a single object as a key/value table (or JSON/YAML dump)."""
        data = to_primitive(obj)
        if not isinstance(data, dict):
            self.console.print(truncate(data, 200))
            return
        if self.fmt in (OutputFormat.JSON, OutputFormat.YAML):
            self.rows([data], columns=fields or list(data.keys()))
            return

        headers = _normalise_columns(fields, data)
        table = Table(
            title=title, header_style="bold cyan", box=None, pad_edge=False, show_header=False
        )
        table.add_column("Field", style="bold", no_wrap=True)
        table.add_column("Value", overflow="fold")
        for key, header in headers:
            table.add_row(header, truncate(data.get(key), 200))
        self.console.print(table)

    def value(self, value: Any) -> None:
        """Print a scalar (or a pre-rendered string)."""
        self.console.print(value)

    def message(self, text: str, *, style: str = "") -> None:
        if not self.quiet:
            self.console.print(f"[{style}]{text}[/{style}]" if style else text)

    def warn(self, text: str) -> None:
        self.err_console.print(f"[yellow]warning:[/yellow] {text}")

    def error(self, text: str) -> None:
        self.err_console.print(f"[red]error:[/red] {text}")

    def success(self, text: str) -> None:
        self.console.print(f"[green]✓[/green] {text}")

    def status_line(self, pairs: Sequence[tuple[str, Any]]) -> None:
        """``label: value`` rows, used by ``2pro auth status``."""
        if self.fmt is OutputFormat.JSON:
            self.console.print_json(json.dumps({k: to_primitive(v) for k, v in pairs}, default=str))
            return
        if self.fmt is OutputFormat.YAML:
            self.console.print(
                yaml.safe_dump(
                    {k: to_primitive(v) for k, v in pairs},
                    sort_keys=False,
                    default_flow_style=False,
                ).rstrip()
            )
            return
        for key, value in pairs:
            self.console.print(f"[bold]{key:<18}[/bold] {truncate(value, 80)}")

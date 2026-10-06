/**
 * Minimal terminal color + table helpers. No external deps.
 */

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  purple: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

export type ColorName = keyof typeof ANSI;

export function color(name: ColorName, text: string): string {
  if (process.env.NO_COLOR) return text;
  return `${ANSI[name]}${text}${ANSI.reset}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const min = 60 * 1000, hour = 60 * min, day = 24 * hour;
  if (diff < min) return "just now";
  if (diff < hour) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`;
  return d.toISOString().slice(0, 10);
}

export function printTable(headers: string[], rows: string[][]): void {
  if (rows.length === 0) {
    console.log("(no results)");
    return;
  }
  const cols = headers.length;
  // Strip ANSI for width calculation
  const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const widths = headers.map((h, i) =>
    Math.max(plain(h).length, ...rows.map((r) => plain(r[i] ?? "").length)),
  );
  const pad = (s: string, i: number) => {
    const extra = widths[i] - plain(s).length;
    return s + " ".repeat(Math.max(0, extra));
  };
  console.log(headers.map((h, i) => color("bold", pad(h, i))).join("  "));
  console.log(widths.map((w) => "─".repeat(w)).join("  "));
  for (const row of rows) {
    console.log(row.map((cell, i) => pad(cell ?? "", i)).join("  "));
  }
  console.log();
  console.log(color("dim", `${rows.length} item${rows.length === 1 ? "" : "s"}`));
}

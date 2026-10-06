/**
 * Minimal .gitignore-style glob matcher.
 *
 * Supported syntax:
 *   *        matches any sequence of non-slash chars
 *   **       matches any sequence of chars including "/"
 *   ?        matches any single non-slash char
 *   [abc]    character class
 *   {a,b,c}  brace alternation (expanded before regex compilation)
 *
 * Patterns match if the pattern describes a prefix of the path followed by
 * any suffix starting at a "/" boundary, unless the pattern ends with a
 * filename character (i.e. the pattern looks like a full file glob).
 *
 * Concretely:
 *   - Patterns ending with "/**"  match everything under that directory.
 *   - Patterns ending with "/"    match the directory and everything in it.
 *   - Patterns ending with a filename glob (e.g. "*.md") match any path
 *     whose last segment matches, regardless of parent dir.
 *   - Patterns starting without a "/" or "**" are anchored at root.
 */

/** Expand bash-style brace alternations {a,b,c}. */
function expandBraces(pattern: string): string[] {
  const out: string[] = [];
  const m = /\{([^{}]+)\}/.exec(pattern);
  if (!m) return [pattern];
  const alts = m[1].split(",").map(s => s.trim());
  for (const alt of alts) {
    const expanded = pattern.slice(0, m.index) + alt + pattern.slice(m.index + m[0].length);
    out.push(...expandBraces(expanded));
  }
  return out;
}

function segmentToRegex(seg: string): string {
  // Convert a single path segment (no slashes) to a regex fragment.
  let re = "";
  let i = 0;
  while (i < seg.length) {
    const c = seg[i];
    if (c === "*") {
      re += "[^/]*";
      i++;
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else if (c === "[") {
      let cls = "[";
      i++;
      if (seg[i] === "!") { cls += "^"; i++; }
      while (i < seg.length && seg[i] !== "]") { cls += seg[i]; i++; }
      if (seg[i] === "]") i++;
      cls += "]";
      re += cls;
    } else if (".+^$(){}|\\".includes(c)) {
      re += "\\" + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return re;
}

export function globToRegex(pattern: string): RegExp {
  let p = pattern.trim().replace(/^\.\//, "");
  if (p.startsWith("/")) p = p.slice(1);

  // Handle trailing "/**" or "/" directory match
  const matchAllUnder = p.endsWith("/**") || p.endsWith("/");
  if (p.endsWith("/**")) p = p.slice(0, -3);
  if (p.endsWith("/")) p = p.slice(0, -1);

  const segments = p.split("/").filter(s => s.length > 0);
  let re = "^";
  let lastWasDoubleStar = false;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === "**") {
      // Collapse consecutive **
      while (segments[i + 1] === "**") i++;
      const isLast = i === segments.length - 1;
      const isFirst = i === 0;
      if (isLast) {
        if (!isFirst) re += "(?:/.*)?";
        else re += ".*";
      } else if (isFirst) {
        re += "(?:.*/)?";
      } else {
        re += "(?:/.*)?";
      }
      lastWasDoubleStar = true;
      continue;
    }
    if (i > 0 && !lastWasDoubleStar) re += "/";
    if (i > 0 && lastWasDoubleStar) re += "/?";
    re += segmentToRegex(seg);
    lastWasDoubleStar = false;
  }

  if (matchAllUnder) {
    re += "(?:/.*)?$";
  } else {
    // If the last segment contains a wildcard, it matches files at any depth under a matching dir;
    // if it's a literal, require the path to equal the pattern (anchor at end).
    const last = segments[segments.length - 1] ?? "";
    const hasWild = /[*?[]/.test(last);
    if (hasWild) {
      re += "(?:/.*)?$";
    } else {
      re += "$";
    }
  }
  return new RegExp(re);
}

export function matchAny(path: string, patterns: string[]): boolean {
  return patterns.some(pat => {
    if (!pat) return false;
    for (const p of expandBraces(pat)) {
      if (globToRegex(p).test(path)) return true;
    }
    return false;
  });
}

/**
 * Very small YAML-subset parser tuned for our config shape:
 *
 *   label-name:
 *     paths:
 *       - glob
 *       - glob
 *     [drafts: true|false]
 *     [size: { max_additions?: n; min_additions?: n; max_deletions?: n }]
 *     [target_branch: main]
 *     [base_branches: [main, develop]]
 *     [remove_on_no_match: true]
 *
 * Supports both top-level maps and lists of rule objects.
 * Lines starting with `#` are comments.
 */

export interface LabelRule {
  label: string;
  paths: string[];
  drafts?: boolean;
  target_branch?: string;
  base_branches?: string[];
  head_branches?: string[];
  max_additions?: number;
  min_additions?: number;
  max_deletions?: number;
  min_deletions?: number;
  max_changed_files?: number;
  authors?: string[];
  remove_on_no_match?: boolean;
  /** Internal: key expecting indented list items. */
  _pendingList?: "base_branches" | "head_branches" | "authors";
}

export interface Config {
  rules: LabelRule[];
}

export function parseYaml(src: string): Config {
  const lines = src.split(/\r?\n/);
  const rules: LabelRule[] = [];
  let current: LabelRule | null = null;
  let inPaths = false;

  const flush = () => {
    if (current && current.label) {
      if (current.target_branch && !current.base_branches) {
        current.base_branches = [current.target_branch];
      }
      rules.push(current);
    }
    current = null;
    inPaths = false;
  };

  for (let raw of lines) {
    // strip comments (outside quotes — good enough for our configs)
    const hashIdx = raw.indexOf("#");
    if (hashIdx !== -1 && !/["'].*#.*["']/.test(raw)) raw = raw.slice(0, hashIdx);
    const line = raw.replace(/\t/g, "    ");
    if (!line.trim()) continue;

    // Top-level key = label name
    const topMatch = /^([^\s:][^:]*):\s*$/.exec(line);
    if (topMatch) {
      flush();
      current = { label: topMatch[1].trim(), paths: [] };
      inPaths = false;
      continue;
    }

    // Sub-key under current label
    const subMatch = /^\s{1,}(\w[\w-]*)\s*:\s*(.*)$/.exec(line);
    if (subMatch && current) {
      const key = subMatch[1];
      let val = subMatch[2].trim();
      inPaths = false;

      if (key === "paths") {
        if (val) {
          // inline list: paths: [a, b]
          const m = /^\[(.*)\]$/.exec(val);
          if (m) current.paths = m[1].split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
          else inPaths = true;
        } else {
          inPaths = true;
        }
        continue;
      }

      if (val === "") {
        // Some keys (like base_branches) can be followed by a list on indented lines
        if (key === "base_branches" || key === "head_branches" || key === "authors") {
          current._pendingList = key;
        }
        continue;
      }
      // inline value
      assign(current, key, val);
      continue;
    }

    // List item under current label
    const listMatch = /^\s{2,}-\s*(.*)$/.exec(line);
    if (listMatch && current) {
      const item = listMatch[1].trim().replace(/^["']|["']$/g, "");
      if (inPaths) {
        current.paths.push(item);
      } else if (current._pendingList) {
        (current[current._pendingList] as string[]).push(item);
      }
      continue;
    }
  }
  flush();
  return { rules };
}

function assign(target: any, key: string, rawValue: string) {
  const value = rawValue.replace(/^["']|["']$/g, "").trim();
  switch (key) {
    case "drafts":
    case "remove_on_no_match":
      target[key] = value === "true";
      break;
    case "max_additions":
    case "min_additions":
    case "max_deletions":
    case "min_deletions":
    case "max_changed_files":
      target[key] = Number(value);
      break;
    case "target_branch":
      target.target_branch = value;
      break;
    case "base_branches":
    case "head_branches":
    case "authors":
      target[key] = value.split(/\s*,\s*/).filter(Boolean);
      break;
    default:
      target[key] = value;
  }
}

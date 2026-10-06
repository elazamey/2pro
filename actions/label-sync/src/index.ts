import { GitHubClient } from "@2pro/sdk";
import { readFile } from "node:fs/promises";

interface LabelDef {
  name: string;
  color: string; // hex without '#'
  description?: string;
  /** Optional list of aliases (other labels to rename to this one). */
  alias?: string[];
}

interface Config {
  labels: LabelDef[];
}

interface ApiLabel {
  id: number;
  name: string;
  color: string;
  description: string | null;
  default: boolean;
}

function setOutput(name: string, value: string) {
  // GitHub Actions output (works with both legacy set-output and new $GITHUB_OUTPUT)
  const outFile = process.env.GITHUB_OUTPUT;
  const line = `${name}=${value}\n`;
  if (outFile) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("node:fs").appendFileSync(outFile, line);
  } else {
    console.log(`::set-output name=${name}::${value}`);
  }
}

function log(group: string, msg: string) {
  console.log(`[${group}] ${msg}`);
}

async function fetchConfig(client: GitHubClient, owner: string, repo: string, path: string): Promise<Config> {
  try {
    // Try to read from repo contents API first
    const file = await client.request<{ content: string; encoding: string }>(
      `/repos/${owner}/${repo}/contents/${path.replace(/^\//, "")}`,
    );
    const decoded = Buffer.from(file.content, "base64").toString("utf8");
    return parseConfig(decoded, path);
  } catch (err: any) {
    if (err?.status !== 404) throw err;
  }
  // Fall back to local filesystem (useful when running against checkout)
  const local = await readFile(path, "utf8").catch(() => null);
  if (local) return parseConfig(local, path);
  throw new Error(`Could not find labels config at '${path}' in repo ${owner}/${repo} or locally.`);
}

function parseConfig(text: string, path: string): Config {
  const trimmed = text.trim();
  if (path.endsWith(".json")) return JSON.parse(trimmed) as Config;
  if (path.endsWith(".yml") || path.endsWith(".yaml")) {
    // Tiny YAML-subset parser: top-level `labels:` list with name/color/description/alias keys.
    return parseSimpleYaml(trimmed);
  }
  // Default: try JSON
  return JSON.parse(trimmed) as Config;
}

function parseSimpleYaml(src: string): Config {
  const lines = src.split(/\r?\n/);
  const labels: LabelDef[] = [];
  let current: LabelDef | null = null;
  let inLabels = false;
  for (const raw of lines) {
    const line = raw.replace(/\t/g, "    ");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (/^labels\s*:/.test(line)) { inLabels = true; continue; }
    if (!inLabels) continue;
    const listMatch = /^(\s*)-\s*(.*)$/.exec(line);
    if (listMatch) {
      const indent = listMatch[1].length;
      const rest = listMatch[2];
      if (indent === 0) { current = null; continue; }
      // New list item
      if (rest.trim()) {
        // inline "- name: foo" style
        const kv = /^(\w+)\s*:\s*(.*)$/.exec(rest);
        current = { name: "", color: "cccccc" };
        if (kv) applyField(current, kv[1], kv[2]);
        labels.push(current);
      } else {
        current = { name: "", color: "cccccc" };
        labels.push(current);
      }
      continue;
    }
    const kvMatch = /^\s{2,}(\w+)\s*:\s*(.*)$/.exec(line);
    if (kvMatch && current) {
      applyField(current, kvMatch[1], kvMatch[2]);
    }
  }
  return { labels: labels.filter(l => l.name) };
}

function applyField(l: LabelDef, key: string, rawValue: string) {
  const value = rawValue.replace(/^["']|["']$/g, "").trim();
  switch (key) {
    case "name": l.name = value; break;
    case "color": l.color = value.replace(/^#/, "").padStart(6, "0").slice(0, 6); break;
    case "description": l.description = value; break;
    case "alias":
      l.alias = value.split(/\s*,\s*/).filter(Boolean);
      break;
  }
}

async function listAllLabels(client: GitHubClient, owner: string, repo: string): Promise<ApiLabel[]> {
  return client.collect<ApiLabel>(`/repos/${owner}/${repo}/labels`, { perPage: 100 });
}

async function sync() {
  const token = process.env.INPUT_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("No GITHUB_TOKEN provided");

  const repoSpec = process.env.INPUT_REPO || process.env.GITHUB_REPOSITORY;
  if (!repoSpec) throw new Error("No repository specified");
  const [owner, repo] = repoSpec.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo: ${repoSpec}`);

  const configPath = process.env.INPUT_CONFIG_PATH || ".github/labels.json";
  const dryRun = (process.env.INPUT_DRY_RUN || "false") === "true";
  const prune = (process.env.INPUT_PRUNE || "true") === "true";

  const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
  const client = new GitHubClient({ token, baseUrl: apiBase });

  log("info", `Target repo: ${owner}/${repo}`);
  log("info", `Config path: ${configPath}`);
  log("info", `Dry run: ${dryRun}  Prune: ${prune}`);

  const config = await fetchConfig(client, owner, repo, configPath);
  log("info", `Desired labels: ${config.labels.length}`);

  const existing = await listAllLabels(client, owner, repo);
  log("info", `Existing labels: ${existing.length}`);

  const desiredByName = new Map<string, LabelDef>();
  for (const d of config.labels) desiredByName.set(d.name.toLowerCase(), d);

  const existingByName = new Map<string, ApiLabel>();
  for (const e of existing) existingByName.set(e.name.toLowerCase(), e);

  // Handle aliases (rename old labels to new canonical names) before CRUD.
  for (const d of config.labels) {
    if (!d.alias) continue;
    for (const a of d.alias) {
      const key = a.toLowerCase();
      if (existingByName.has(key) && key !== d.name.toLowerCase()) {
        const old = existingByName.get(key)!;
        if (dryRun) {
          log("rename", `Would rename '${old.name}' → '${d.name}'`);
        } else {
          log("rename", `Renaming '${old.name}' → '${d.name}'`);
          await client.request(`/repos/${owner}/${repo}/labels/${encodeURIComponent(old.name)}`, {
            method: "PATCH",
            body: { new_name: d.name, color: d.color.replace(/^#/, ""), description: d.description ?? "" },
          });
          existingByName.delete(key);
          existingByName.set(d.name.toLowerCase(), { ...old, name: d.name, color: d.color, description: d.description ?? null });
        }
      }
    }
  }

  let created = 0, updated = 0, deleted = 0;

  // Create or update
  for (const d of config.labels) {
    const key = d.name.toLowerCase();
    const color = d.color.replace(/^#/, "").padStart(6, "0").slice(0, 6);
    const current = existingByName.get(key);
    if (!current) {
      if (dryRun) log("create", `Would create label '${d.name}' (#${color})`);
      else {
        await client.request(`/repos/${owner}/${repo}/labels`, {
          method: "POST",
          body: { name: d.name, color, description: d.description ?? "" },
        });
        log("create", `Created '${d.name}'`);
      }
      created++;
    } else {
      const needsUpdate =
        current.color.toLowerCase() !== color.toLowerCase() ||
        (current.description ?? "") !== (d.description ?? "");
      if (needsUpdate) {
        if (dryRun) log("update", `Would update '${d.name}'`);
        else {
          await client.request(`/repos/${owner}/${repo}/labels/${encodeURIComponent(current.name)}`, {
            method: "PATCH",
            body: { color, description: d.description ?? "" },
          });
          log("update", `Updated '${d.name}'`);
        }
        updated++;
      }
    }
  }

  // Prune labels not in desired set
  if (prune) {
    const desiredNames = new Set(config.labels.map(l => l.name.toLowerCase()));
    for (const e of existing) {
      if (e.default) continue; // don't delete default GitHub labels
      const key = e.name.toLowerCase();
      if (!desiredNames.has(key)) {
        // also check if it's an alias of a desired label
        const isAlias = config.labels.some(l => (l.alias ?? []).some(a => a.toLowerCase() === key));
        if (isAlias) continue;
        if (dryRun) log("delete", `Would delete '${e.name}'`);
        else {
          await client.request(`/repos/${owner}/${repo}/labels/${encodeURIComponent(e.name)}`, { method: "DELETE" });
          log("delete", `Deleted '${e.name}'`);
        }
        deleted++;
      }
    }
  }

  const summary = `created=${created} updated=${updated} deleted=${deleted} dryRun=${dryRun}`;
  log("summary", summary);
  setOutput("summary", summary);
  setOutput("created", String(created));
  setOutput("updated", String(updated));
  setOutput("deleted", String(deleted));
}

sync().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});

import { GitHubClient } from "@2pro/sdk";
import { readFile } from "node:fs/promises";
import { parseYaml, type Config, type LabelRule } from "./yaml.js";
import { matchAny } from "./glob.js";

interface PullRequestLike {
  number: number;
  draft: boolean;
  additions: number;
  deletions: number;
  changed_files: number;
  base: { ref: string };
  head: { ref: string };
  user: { login: string } | null;
  labels: { name: string }[];
}

interface PRFile {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
}

function setOutput(name: string, value: string) {
  const outFile = process.env.GITHUB_OUTPUT;
  const line = `${name}=${value}\n`;
  if (outFile) {
    require("node:fs").appendFileSync(outFile, line);
  } else {
    console.log(`::set-output name=${name}::${value}`);
  }
}

function log(level: "info" | "add" | "remove" | "skip", msg: string) {
  const prefix = { info: "ℹ", add: "+", remove: "-", skip: "·" }[level];
  console.log(`${prefix} ${msg}`);
}

async function fetchConfig(client: GitHubClient, owner: string, repo: string, path: string, ref: string): Promise<Config> {
  try {
    const file = await client.request<{ content: string }>(
      `/repos/${owner}/${repo}/contents/${path.replace(/^\//, "")}`,
      { search: { ref } },
    );
    const decoded = Buffer.from(file.content, "base64").toString("utf8");
    return parseConfig(decoded, path);
  } catch (err: any) {
    if (err?.status !== 404) throw err;
  }
  const local = await readFile(path, "utf8").catch(() => null);
  if (local) return parseConfig(local, path);
  return defaultConfig();
}

function parseConfig(text: string, path: string): Config {
  if (path.endsWith(".json")) return JSON.parse(text) as Config;
  return parseYaml(text);
}

function defaultConfig(): Config {
  return {
    rules: [
      { label: "frontend",  paths: ["client/**", "src/**/*.{tsx,jsx,css,scss,vue,svelte}", "public/**", "web/**", "ui/**"] },
      { label: "backend",   paths: ["server/**", "src/**/*.{go,py,rb,java,kt,rs}", "api/**", "cmd/**", "internal/**"] },
      { label: "docs",      paths: ["docs/**", "**/*.md"], remove_on_no_match: true },
      { label: "ci",        paths: [".github/workflows/**", ".circleci/**", ".gitlab-ci.yml", "Jenkinsfile"] },
      { label: "tests",     paths: ["**/*.test.*", "**/*.spec.*", "__tests__/**", "test/**", "tests/**"] },
      { label: "dependencies", paths: ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "go.mod", "go.sum", "requirements.txt", "Cargo.toml", "Cargo.lock", "pyproject.toml", "Gemfile", "Gemfile.lock"] },
      { label: "config",    paths: ["*.json", "*.yml", "*.yaml", "*.toml", "*.ini", ".env*", "Dockerfile", "docker-compose*"], remove_on_no_match: true },
      { label: "draft",     paths: [], drafts: true, remove_on_no_match: true },
    ],
  };
}

async function getPR(client: GitHubClient, owner: string, repo: string, number: number): Promise<PullRequestLike> {
  return client.request<PullRequestLike>(`/repos/${owner}/${repo}/pulls/${number}`);
}

async function listPRFiles(client: GitHubClient, owner: string, repo: string, number: number): Promise<PRFile[]> {
  return client.collect<PRFile>(`/repos/${owner}/${repo}/pulls/${number}/files`, { perPage: 100 });
}

function ruleMatches(rule: LabelRule, pr: PullRequestLike, files: PRFile[]): boolean {
  // Draft filter
  if (rule.drafts === true && !pr.draft) return false;
  if (rule.drafts === false && pr.draft) return false;

  // Branch filters
  if (rule.base_branches && rule.base_branches.length && !rule.base_branches.includes(pr.base.ref)) return false;
  if (rule.head_branches && rule.head_branches.length && !rule.head_branches.includes(pr.head.ref)) return false;

  // Author filter
  if (rule.authors && rule.authors.length) {
    const login = pr.user?.login ?? "";
    if (!rule.authors.some(a => a.toLowerCase() === login.toLowerCase())) return false;
  }

  // Size filters
  if (rule.max_additions != null && pr.additions > rule.max_additions) return false;
  if (rule.min_additions != null && pr.additions < rule.min_additions) return false;
  if (rule.max_deletions != null && pr.deletions > rule.max_deletions) return false;
  if (rule.min_deletions != null && pr.deletions < rule.min_deletions) return false;
  if (rule.max_changed_files != null && pr.changed_files > rule.max_changed_files) return false;

  // Paths filter
  if (rule.paths.length > 0) {
    const names = files.map(f => f.filename);
    if (!matchAnyPath(names, rule.paths)) return false;
  }

  return true;
}

function matchAnyPath(paths: string[], patterns: string[]): boolean {
  return paths.some(p => matchAny(p, patterns));
}

async function run() {
  const token = process.env.INPUT_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("No GITHUB_TOKEN provided");

  const repoSpec = process.env.INPUT_REPO || process.env.GITHUB_REPOSITORY;
  if (!repoSpec) throw new Error("No repository specified");
  const [owner, repo] = repoSpec.split("/");

  // Determine PR number: input, or pull_request event payload
  let prNumber = Number(process.env.INPUT_PR_NUMBER || "");
  if (!prNumber) {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (eventPath) {
      try {
        const evt = JSON.parse(await readFile(eventPath, "utf8"));
        if (evt.pull_request?.number) prNumber = evt.pull_request.number;
      } catch { /* */ }
    }
  }
  if (!prNumber) throw new Error("Could not determine PR number. Set pr-number input or trigger on pull_request event.");

  const dryRun = (process.env.INPUT_DRY_RUN || "false") === "true";
  const alwaysAdd = (process.env.INPUT_ADD_LABELS || "").split(",").map(s => s.trim()).filter(Boolean);
  const configPath = process.env.INPUT_CONFIG_PATH || ".github/auto-label.yml";

  const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
  const client = new GitHubClient({ token, baseUrl: apiBase });

  log("info", `PR #${prNumber} in ${owner}/${repo}`);
  log("info", `Config: ${configPath}  dry-run: ${dryRun}`);

  const pr = await getPR(client, owner, repo, prNumber);
  const files = await listPRFiles(client, owner, repo, prNumber);
  log("info", `${files.length} file(s) changed; +${pr.additions} -${pr.deletions}; draft=${pr.draft}; ${pr.base.ref} ← ${pr.head.ref}`);

  const config = await fetchConfig(client, owner, repo, configPath, pr.head.ref);
  log("info", `${config.rules.length} rule(s) loaded`);

  const currentLabels = new Set(pr.labels.map(l => l.name));
  const desiredLabels = new Set(currentLabels);
  const added: string[] = [];
  const removed: string[] = [];

  // Apply static "always add" labels
  for (const lbl of alwaysAdd) {
    if (!desiredLabels.has(lbl)) { desiredLabels.add(lbl); added.push(lbl); }
  }

  // Evaluate rules
  for (const rule of config.rules) {
    const ok = ruleMatches(rule, pr, files);
    if (ok) {
      if (!desiredLabels.has(rule.label)) {
        desiredLabels.add(rule.label);
        added.push(rule.label);
      }
    } else if (rule.remove_on_no_match && desiredLabels.has(rule.label)) {
      // Only remove labels that this action added or that are configured with remove_on_no_match.
      // Be conservative: never remove labels not defined in our config.
      desiredLabels.delete(rule.label);
      removed.push(rule.label);
    }
  }

  // Compute the set of labels to send. Keep existing labels NOT governed by any rule.
  const governedLabels = new Set(config.rules.map(r => r.label));
  const finalLabels = new Set<string>();
  for (const l of currentLabels) if (!governedLabels.has(l) && !removed.includes(l)) finalLabels.add(l);
  for (const l of desiredLabels) finalLabels.add(l);

  const toAdd = [...finalLabels].filter(l => !currentLabels.has(l));
  const toRemove = [...currentLabels].filter(l => !finalLabels.has(l) && governedLabels.has(l));

  if (toAdd.length === 0 && toRemove.length === 0) {
    log("info", "Labels already up-to-date. Nothing to do.");
  } else {
    for (const l of toAdd) {
      log("add", `${dryRun ? "[dry-run] would add" : "adding"} '${l}'`);
    }
    for (const l of toRemove) {
      log("remove", `${dryRun ? "[dry-run] would remove" : "removing"} '${l}'`);
    }
    if (!dryRun) {
      await client.request(`/repos/${owner}/${repo}/issues/${prNumber}/labels`, {
        method: "PUT",
        body: { labels: [...finalLabels] },
      });
    }
  }

  const summary = `added=${toAdd.length} removed=${toRemove.length} dryRun=${dryRun} labels=[${[...finalLabels].join(",")}]`;
  log("info", summary);
  setOutput("added", toAdd.join(","));
  setOutput("removed", toRemove.join(","));
  setOutput("summary", summary);
}

run().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});

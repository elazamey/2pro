import { GitHub } from "@2pro/sdk";
import { FigmaClient, parseFigmaUrl } from "@2pro/figma";
import { extractDesignTokens, tokensToCss, tokensToTailwindTheme } from "@2pro/figma";
import { generateTailwind } from "@2pro/figma";
import { GoogleClient, buildAuthorizeUrl, exchangeCodeForTokens, scopes, DRIVE_READONLY, DRIVE_FILE, GMAIL_READONLY, GMAIL_SEND, GMAIL_MODIFY, fileTokenStore } from "@2pro/google";
import { GitLab } from "@2pro/gitlab";
import { cliAuthorize } from "./google-cli-auth.js";
import { printTable, formatDate, color } from "./format.js";
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const VERSION = "1.0.0";

function getToken(): string | undefined {
  // 1. env
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  // 2. ~/.config/gh/hosts.yml (used by official gh CLI)
  try {
    const hosts = readFileSync(join(homedir(), ".config", "gh", "hosts.yml"), "utf8");
    const m = /oauth_token:\s*(\S+)/.exec(hosts);
    if (m) return m[1];
  } catch {
    // ignore
  }
  return undefined;
}

function createClient(): GitHub {
  const token = getToken();
  if (!token) {
    console.error(
      color(
        "red",
        "No GitHub token found. Set GITHUB_TOKEN or run `gh auth login` first.",
      ),
    );
    process.exit(1);
  }
  return new GitHub({ token });
}

function requireGoogleConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(color("red", "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set."));
    console.error("Create an OAuth 2.0 Client ID at https://console.cloud.google.com/apis/credentials");
    console.error("  - Application type: Desktop app (or Web app with http://localhost:42735/callback)");
    console.error("  - Enable the Drive API and Gmail API for that project.");
    console.error("  - export GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy");
    process.exit(1);
  }
  return { clientId, clientSecret, redirectUri: "http://localhost:42735/callback" };
}

async function getGoogleClient(): Promise<{ client: InstanceType<typeof GoogleClient>; account: string }> {
  const cfg = requireGoogleConfig();
  const store = fileTokenStore();
  const creds = await store.load();
  if (!creds) {
    console.error(color("red", "Not signed in to Google. Run `2pro google login` first."));
    process.exit(1);
  }
  const client = new GoogleClient(cfg, creds);
  return { client, account: "default" };
}

function getGitLabClient(): GitLab {
  const token = process.env.GITLAB_TOKEN;
  if (!token) {
    console.error(color("red", "GITLAB_TOKEN not set. Create a personal access token at GitLab (Settings → Access Tokens)."));
    console.error("  For self-hosted instances also set GITLAB_API_URL=https://gitlab.mycompany.com/api/v4");
    process.exit(1);
  }
  return new GitLab({ token, baseUrl: process.env.GITLAB_API_URL });
}

function openBrowser(url: string) {
  const { exec } = require("node:child_process") as typeof import("node:child_process");
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try { exec(`${cmd} "${url}"`); } catch { /* silent */ }
}

function help() {
  console.log(`2pro v${VERSION} - a tiny GitHub CLI

USAGE:
  2pro <command> [options]

COMMANDS:
  auth status                 Show authenticated user
  repos list [--user <u>]     List repositories (yours, or for a user/org)
  repos get <owner>/<repo>    Show details for a repo
  repos create <name> [opts]  Create a repo
                              Options: --private, --desc "..." , --org <org>, --auto-init
  issues list <owner>/<repo> [--state open|closed|all]
                              List issues in a repo
  issues show <owner>/<repo> <number>
                              Show an issue
  issues create <owner>/<repo> --title "..." [--body "..."] [--label bug]
                              Create an issue
  issues close <owner>/<repo> <number>
                              Close an issue
  pr list <owner>/<repo> [--state open|closed|all]
                              List pull requests
  pr show <owner>/<repo> <number>
                              Show a pull request
  pr create <owner>/<repo> --title "..." --head <branch> --base main [--body "..."] [--draft]
                              Create a pull request
  pr merge <owner>/<repo> <number> [--method merge|squash|rebase]
                              Merge a pull request
  actions runs <owner>/<repo> [--branch <b>] [--status <s>]
                              List recent workflow runs
  actions jobs <owner>/<repo> <run-id>
                              List jobs for a run
  actions rerun <owner>/<repo> <run-id>
                              Rerun a workflow run
  actions cancel <owner>/<repo> <run-id>
                              Cancel a workflow run
  workflows list <owner>/<repo>
                              List workflows in a repo
  figma tokens <url-or-key>   Extract design tokens (colors, typography, spacing, radii)
                              Options: --format pretty|css|tailwind|json (default: pretty)
  figma code <url-or-key>     Generate HTML+Tailwind code from a Figma frame
                              Options: --node <id-or-url> (frame to render; default: first page frame)
                                        --out <file>      (write HTML to a file instead of stdout)
                                        --plain           (use inline CSS instead of Tailwind classes)
  google login                Authenticate with Google (opens browser, saves token to ~/.config/2pro/)
  google status               Show Google auth status
  google logout               Remove Google credentials
  drive list [--folder <id>]  List recent Google Drive files (default: root, order by modified)
  drive search <query>        Search files by name or Drive query
  drive upload <path> --name <name> [--folder <id>]
                              Upload a local file to Drive
  drive mkdir <name> [--folder <id>]
                              Create a folder in Drive (default root)
  gmail list [--unread] [--query <q>] [--max <n>]
                              List recent Gmail messages
  gmail show <message-id>     Show a message (headers + decoded body)
  gmail send --to <email> --subject <s> --body <text> [--html <file>] [--cc <email>]
                              Send an email (supports HTML from --html file path)
  gmail unread                Show unread count
  gitlab projects             List your GitLab projects (GITLAB_TOKEN, GITLAB_API_URL optional)
  gitlab project <id>         Show project details
  gitlab issues <id> [--state opened|closed|all]
                              List issues for a GitLab project
  gitlab mr <id> [--state opened|closed|merged|all]
                              List merge requests
  gitlab pipelines <id>       List pipeline runs for a project
  help                        Show this help
  version                     Show version

EXAMPLES:
  2pro repos list
  2pro issues list octocat/Hello-World --state open
  2pro pr create me/myrepo --title "Fix bug" --head fix-1 --base main --body "..."
  2pro actions runs me/myrepo --branch main
`);
}

function parseRepo(slug: string): [string, string] {
  const [owner, repo] = slug.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo slug: ${slug}. Expected owner/repo.`);
  return [owner, repo];
}

export async function runCli(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "help" || args.includes("-h") || args.includes("--help")) {
    help();
    return;
  }
  if (args[0] === "version" || args[0] === "--version" || args[0] === "-v") {
    console.log(VERSION);
    return;
  }

  const gh = createClient();
  const cmd = args[0];
  const rest = args.slice(1);

  switch (cmd) {
    case "auth": {
      if (rest[0] === "status") {
        const me = await gh.users.me();
        console.log(color("green", `✓ Logged in as ${me.login}`));
        console.log(`  Name: ${me.name ?? "(none)"}`);
        console.log(`  Plan: ${me.plan?.name ?? "free"}`);
        console.log(`  Repos public/private: ${me.public_repos} / ${me.total_private_repos ?? 0}`);
        return;
      }
      throw new Error(`Unknown auth command: ${rest[0]}`);
    }

    case "repos": {
      const sub = rest[0];
      if (sub === "list") {
        const { values } = parseArgs({ args: rest.slice(1), options: {
          user: { type: "string" },
          org: { type: "string" },
          sort: { type: "string", default: "updated" },
        }, allowPositionals: false });
        let repos;
        if (values.org) repos = await gh.repos.listForOrg(values.org, { sort: values.sort as any });
        else if (values.user) repos = await gh.repos.listForUser(values.user, { sort: values.sort as any });
        else repos = await gh.repos.list({ sort: values.sort as any, perPage: 30 });
        printTable(
          ["Name", "Visibility", "Stars", "Forks", "Issues", "Updated"],
          repos.map((r) => [
            color("cyan", r.full_name),
            r.private ? color("yellow", "private") : color("green", "public"),
            String(r.stargazers_count),
            String(r.forks_count),
            String(r.open_issues_count),
            formatDate(r.updated_at),
          ]),
        );
        return;
      }
      if (sub === "get") {
        const [owner, repo] = parseRepo(rest[1] ?? "");
        const r = await gh.repos.get(owner, repo);
        console.log(color("cyan", r.full_name));
        if (r.description) console.log(r.description);
        console.log(`  URL:      ${r.html_url}`);
        console.log(`  Default:  ${r.default_branch}`);
        console.log(`  Language: ${r.language ?? "(none)"}`);
        console.log(`  Stars:    ${r.stargazers_count}  Forks: ${r.forks_count}  Issues: ${r.open_issues_count}`);
        console.log(`  Created:  ${formatDate(r.created_at)}`);
        console.log(`  Pushed:   ${formatDate(r.pushed_at)}`);
        return;
      }
      if (sub === "create") {
        const name = rest[1];
        if (!name) throw new Error("repo name required");
        const { values } = parseArgs({ args: rest.slice(2), options: {
          private: { type: "boolean" },
          desc: { type: "string" },
          org: { type: "string" },
          "auto-init": { type: "boolean" },
          homepage: { type: "string" },
        }, allowPositionals: false });
        const r = await gh.repos.create({
          name,
          description: values.desc,
          private: values.private,
          org: values.org,
          auto_init: values["auto-init"],
          homepage: values.homepage,
        });
        console.log(color("green", `✓ Created ${r.full_name}`));
        console.log(r.html_url);
        return;
      }
      throw new Error(`Unknown repos command: ${sub}`);
    }

    case "issues": {
      const sub = rest[0];
      if (sub === "list") {
        const [owner, repo] = parseRepo(rest[1] ?? "");
        const { values } = parseArgs({ args: rest.slice(2), options: {
          state: { type: "string", default: "open" },
        }});
        const issues = await gh.issues.list(owner, repo, { state: values.state as any });
        printTable(
          ["#", "State", "Title", "Author", "Comments", "Updated"],
          issues.filter(i => !i.pull_request).map((i) => [
            color("cyan", `#${i.number}`),
            i.state === "open" ? color("green", "open") : color("red", "closed"),
            i.title.slice(0, 60),
            i.user?.login ?? "",
            String(i.comments),
            formatDate(i.updated_at),
          ]),
        );
        return;
      }
      if (sub === "show") {
        const [owner, repo] = parseRepo(rest[1] ?? "");
        const num = Number(rest[2]);
        const i = await gh.issues.get(owner, repo, num);
        console.log(color("cyan", `#${i.number} ${i.title}`));
        console.log(`  ${color("dim", `by ${i.user?.login ?? "?"} on ${formatDate(i.created_at)}`)}`);
        console.log(`  State: ${i.state}  Comments: ${i.comments}  Labels: ${i.labels.map(l => l.name).join(", ") || "(none)"}`);
        console.log(`  ${i.html_url}`);
        if (i.body) {
          console.log();
          console.log(i.body);
        }
        return;
      }
      if (sub === "create") {
        const [owner, repo] = parseRepo(rest[1] ?? "");
        const { values } = parseArgs({ args: rest.slice(2), options: {
          title: { type: "string" },
          body: { type: "string" },
          label: { type: "string", multiple: true },
          assignee: { type: "string", multiple: true },
        }, strict: true });
        if (!values.title) throw new Error("--title is required");
        const i = await gh.issues.create(owner, repo, {
          title: values.title,
          body: values.body,
          labels: values.label as string[],
          assignees: values.assignee as string[],
        });
        console.log(color("green", `✓ Created issue #${i.number}`));
        console.log(i.html_url);
        return;
      }
      if (sub === "close") {
        const [owner, repo] = parseRepo(rest[1] ?? "");
        const num = Number(rest[2]);
        const i = await gh.issues.close(owner, repo, num);
        console.log(color("green", `✓ Closed issue #${i.number}`));
        return;
      }
      throw new Error(`Unknown issues command: ${sub}`);
    }

    case "pr":
    case "pulls": {
      const sub = rest[0];
      if (sub === "list") {
        const [owner, repo] = parseRepo(rest[1] ?? "");
        const { values } = parseArgs({ args: rest.slice(2), options: {
          state: { type: "string", default: "open" },
        }});
        const prs = await gh.pulls.list(owner, repo, { state: values.state as any });
        printTable(
          ["#", "State", "Title", "Author", "Branch", "Updated"],
          prs.map((p) => [
            color("cyan", `#${p.number}`),
            p.merged ? color("purple", "merged") : (p.draft ? color("gray", "draft") : (p.state === "open" ? color("green", "open") : color("red", "closed"))),
            p.title.slice(0, 55),
            p.user?.login ?? "",
            `${p.head.ref} → ${p.base.ref}`,
            formatDate(p.updated_at),
          ]),
        );
        return;
      }
      if (sub === "show") {
        const [owner, repo] = parseRepo(rest[1] ?? "");
        const num = Number(rest[2]);
        const p = await gh.pulls.get(owner, repo, num);
        console.log(color("cyan", `#${p.number} ${p.title}`));
        console.log(`  ${p.head.ref} → ${p.base.ref}  by ${p.user?.login ?? "?"}  ${p.draft ? "[draft] " : ""}${p.merged ? color("purple", "merged") : p.state}`);
        console.log(`  +${p.additions} -${p.deletions} across ${p.changed_files} files`);
        console.log(`  ${p.html_url}`);
        if (p.body) { console.log(); console.log(p.body); }
        return;
      }
      if (sub === "create") {
        const [owner, repo] = parseRepo(rest[1] ?? "");
        const { values } = parseArgs({ args: rest.slice(2), options: {
          title: { type: "string" },
          head: { type: "string" },
          base: { type: "string", default: "main" },
          body: { type: "string" },
          draft: { type: "boolean" },
        }, strict: true });
        if (!values.title || !values.head) throw new Error("--title and --head are required");
        const p = await gh.pulls.create(owner, repo, {
          title: values.title,
          head: values.head,
          base: values.base!,
          body: values.body,
          draft: values.draft,
        });
        console.log(color("green", `✓ Opened PR #${p.number}`));
        console.log(p.html_url);
        return;
      }
      if (sub === "merge") {
        const [owner, repo] = parseRepo(rest[1] ?? "");
        const num = Number(rest[2]);
        const { values } = parseArgs({ args: rest.slice(3), options: {
          method: { type: "string", default: "merge" },
        }});
        const r = await gh.pulls.merge(owner, repo, num, { merge_method: values.method as any });
        console.log(color("green", `✓ Merged PR #${num}`), r.message);
        return;
      }
      throw new Error(`Unknown pr command: ${sub}`);
    }

    case "actions": {
      const sub = rest[0];
      if (sub === "runs") {
        const [owner, repo] = parseRepo(rest[1] ?? "");
        const { values } = parseArgs({ args: rest.slice(2), options: {
          branch: { type: "string" },
          status: { type: "string" },
        }});
        const runs = await gh.actions.listRuns(owner, repo, { branch: values.branch, status: values.status as any, perPage: 25 });
        printTable(
          ["ID", "Status", "Conclusion", "Name", "Branch", "Event", "Started"],
          runs.map((r) => [
            color("cyan", `#${r.run_number}`),
            r.status,
            r.conclusion
              ? (r.conclusion === "success" ? color("green", r.conclusion) : color("red", r.conclusion))
              : color("yellow", r.status ?? "?"),
            (r.name ?? "").slice(0, 35),
            r.head_branch ?? "",
            r.event ?? "",
            r.run_started_at ? formatDate(r.run_started_at) : "-",
          ]),
        );
        return;
      }
      if (sub === "jobs") {
        const [owner, repo] = parseRepo(rest[1] ?? "");
        const runId = Number(rest[2]);
        if (!runId) throw new Error("run-id required");
        const jobs = await gh.actions.listJobs(owner, repo, runId);
        printTable(
          ["Name", "Status", "Conclusion", "Started", "Finished"],
          jobs.map((j) => [
            j.name,
            j.status,
            j.conclusion
              ? (j.conclusion === "success" ? color("green", j.conclusion) : color("red", j.conclusion))
              : color("yellow", j.status ?? "?"),
            j.started_at ? formatDate(j.started_at) : "-",
            j.completed_at ? formatDate(j.completed_at) : "-",
          ]),
        );
        return;
      }
      if (sub === "rerun") {
        const [owner, repo] = parseRepo(rest[1] ?? "");
        const runId = Number(rest[2]);
        await gh.actions.rerun(owner, repo, runId);
        console.log(color("green", `✓ Re-run requested for ${runId}`));
        return;
      }
      if (sub === "cancel") {
        const [owner, repo] = parseRepo(rest[1] ?? "");
        const runId = Number(rest[2]);
        await gh.actions.cancel(owner, repo, runId);
        console.log(color("green", `✓ Cancelled run ${runId}`));
        return;
      }
      throw new Error(`Unknown actions command: ${sub}`);
    }

    case "workflows": {
      const sub = rest[0];
      if (sub === "list") {
        const [owner, repo] = parseRepo(rest[1] ?? "");
        const wfs = await gh.actions.listWorkflows(owner, repo);
        printTable(
          ["ID", "Name", "State", "Path"],
          wfs.map((w) => [
            String(w.id),
            color("cyan", w.name),
            w.state === "active" ? color("green", w.state) : color("yellow", w.state),
            w.path,
          ]),
        );
        return;
      }
      throw new Error(`Unknown workflows command: ${sub}`);
    }

    case "figma": {
      const token = process.env.FIGMA_ACCESS_TOKEN;
      if (!token) {
        console.error(color("red", "FIGMA_ACCESS_TOKEN not set. Create one at https://www.figma.com/settings."));
        process.exit(1);
      }
      const figma = new FigmaClient({ token });
      const sub = rest[0];

      if (sub === "tokens") {
        const input = rest[1];
        if (!input) throw new Error("Figma URL or file key required");
        const { values } = parseArgs({ args: rest.slice(2), options: {
          format: { type: "string", default: "pretty" },
        }});
        const { file, node } = await figma.resolve(input);
        const source = node ?? file.document;
        // Wrap single node in a fake file so the extractor can walk it (extractDesignTokens expects a file).
        const tokens = extractDesignTokens({ ...file, document: source as any });
        const fmt = values.format;
        if (fmt === "json") {
          console.log(JSON.stringify(tokens, null, 2));
        } else if (fmt === "css") {
          console.log(tokensToCss(tokens));
        } else if (fmt === "tailwind") {
          console.log(tokensToTailwindTheme(tokens));
        } else {
          console.log(color("cyan", `Figma file: ${file.name}`));
          console.log(color("bold", `\nColors (${tokens.colors.length})`));
          for (const c of tokens.colors) {
            console.log(`  ${color("bold", c.hex.padEnd(10))} ${c.name}`);
          }
          console.log(color("bold", `\nTypography (${tokens.typography.length})`));
          for (const t of tokens.typography) {
            console.log(`  ${t.fontSize}px/${Math.round(t.lineHeight ?? t.fontSize * 1.4)}px ${t.fontWeight} ${t.fontFamily}  ${color("dim", t.name)}`);
          }
          console.log(color("bold", `\nSpacing (${tokens.spacing.length})`));
          console.log("  " + tokens.spacing.map(s => `${s.value}px`).join(", "));
          console.log(color("bold", `\nRadii (${tokens.radii.length})`));
          console.log("  " + tokens.radii.map(r => `${r.value}px`).join(", "));
        }
        return;
      }

      if (sub === "code") {
        const input = rest[1];
        if (!input) throw new Error("Figma URL or file key required");
        const { values } = parseArgs({ args: rest.slice(2), options: {
          node: { type: "string" },
          out: { type: "string" },
          plain: { type: "boolean" },
        }});
        const parsed = parseFigmaUrl(input);
        let targetNode;
        if (values.node) {
          const { fileKey, nodeId } = parseFigmaUrl(values.node);
          const nodes = await figma.getNodes(fileKey ?? parsed.fileKey, [nodeId ?? values.node]);
          targetNode = Object.values(nodes)[0]?.document;
        } else if (parsed.nodeId) {
          const nodes = await figma.getNodes(parsed.fileKey, [parsed.nodeId]);
          targetNode = Object.values(nodes)[0]?.document;
        } else {
          const file = await figma.getFile(parsed.fileKey);
          // Find the first top-level Frame on the first page.
          const page = file.document.children?.[0];
          targetNode = page?.children?.find(c => c.type === "FRAME" || c.type === "COMPONENT" || c.type === "INSTANCE");
          if (!targetNode) throw new Error("No frame found on the first page. Pass --node <url-or-id>.");
        }
        if (!targetNode) throw new Error("Could not resolve target node.");
        const { html, warnings } = generateTailwind(targetNode as any);
        const doc = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(targetNode.name)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen p-8">
${html}
</body>
</html>`;
        if (values.out) {
          const { writeFileSync } = await import("node:fs");
          writeFileSync(values.out, doc);
          console.log(color("green", `✓ Wrote ${values.out}`));
        } else {
          console.log(doc);
        }
        for (const w of warnings) console.error(color("yellow", `! ${w}`));
        return;
      }

      throw new Error(`Unknown figma command: ${sub}. Try 'tokens' or 'code'.`);
    }

    case "google": {
      const sub = rest[0];
      const cfg = requireGoogleConfig();
      const store = fileTokenStore();
      if (sub === "login") {
        console.log(color("cyan", "Authenticating with Google…"));
        const creds = await cliAuthorize({
          clientId: cfg.clientId,
          clientSecret: cfg.clientSecret,
          scopes: [DRIVE_READONLY, DRIVE_FILE, GMAIL_READONLY, GMAIL_SEND, GMAIL_MODIFY],
          open: openBrowser,
        });
        await store.save(creds);
        console.log(color("green", "✓ Authenticated. Credentials saved."));
        return;
      }
      if (sub === "status") {
        const creds = await store.load();
        if (!creds) { console.log(color("yellow", "Not signed in.")); return; }
        const exp = creds.expiry_date ? new Date(creds.expiry_date).toLocaleString() : "unknown";
        console.log(color("green", "✓ Signed in to Google"));
        console.log(`  Token scope: ${creds.scope ?? "(unknown)"}`);
        console.log(`  Expires:     ${exp}`);
        console.log(`  Stored in:   ${store.path}`);
        return;
      }
      if (sub === "logout") {
        await store.clear();
        console.log(color("green", "✓ Signed out, credentials removed."));
        return;
      }
      throw new Error(`Unknown google command: ${sub}. Try 'login', 'status', or 'logout'.`);
    }

    case "drive": {
      const { client } = await getGoogleClient();
      const sub = rest[0];
      if (sub === "list") {
        const { values } = parseArgs({ args: rest.slice(1), options: {
          folder: { type: "string" },
          max: { type: "string", default: "20" },
          query: { type: "string" },
        }});
        const r = await client.drive.list({
          folderId: values.folder || "root",
          pageSize: Number(values.max),
          query: values.query,
          trashed: false,
        });
        printTable(
          ["Name", "Type", "Size", "Modified", "ID"],
          r.files.map(f => [
            f.webViewLink ? f.name : color("dim", f.name),
            f.mimeType === "application/vnd.google-apps.folder" ? color("blue", "folder") : f.mimeType.split("/").pop() ?? "file",
            f.size ? `${(Number(f.size) / 1024).toFixed(1)} KB` : "-",
            f.modifiedTime ? formatDate(f.modifiedTime) : "-",
            color("dim", f.id),
          ]),
        );
        return;
      }
      if (sub === "search") {
        const q = rest.slice(1).join(" ");
        if (!q) throw new Error("query required");
        const r = await client.drive.search(q, { pageSize: 20 });
        printTable(
          ["Name", "Type", "Modified", "ID"],
          r.files.map(f => [
            f.name,
            f.mimeType.split("/").pop() ?? "file",
            f.modifiedTime ? formatDate(f.modifiedTime) : "-",
            color("dim", f.id),
          ]),
        );
        return;
      }
      if (sub === "upload") {
        const filePath = rest[1];
        if (!filePath) throw new Error("file path required");
        const { values } = parseArgs({ args: rest.slice(2), options: {
          name: { type: "string" },
          folder: { type: "string" },
        }, strict: true });
        const name = values.name || filePath.split("/").pop() || "file";
        const f = await client.drive.upload({ name, filePath, parentFolderId: values.folder });
        console.log(color("green", `✓ Uploaded ${name}`));
        console.log(f.webViewLink ?? f.id);
        return;
      }
      if (sub === "mkdir") {
        const name = rest[1];
        if (!name) throw new Error("folder name required");
        const { values } = parseArgs({ args: rest.slice(2), options: { folder: { type: "string" } }});
        const f = await client.drive.createFolder(name, values.folder || "root");
        console.log(color("green", `✓ Created folder ${name}`));
        console.log(f.webViewLink ?? f.id);
        return;
      }
      throw new Error(`Unknown drive command: ${sub}`);
    }

    case "gmail": {
      const { client } = await getGoogleClient();
      const sub = rest[0];
      if (sub === "list") {
        const { values } = parseArgs({ args: rest.slice(1), options: {
          unread: { type: "boolean" },
          query: { type: "string" },
          max: { type: "string", default: "20" },
        }});
        let q = values.query || "";
        if (values.unread) q = (q ? q + " " : "") + "is:unread";
        const r = await client.gmail.list({ query: q || undefined, maxResults: Number(values.max) });
        printTable(
          ["", "From", "Subject", "Date"],
          r.messages.map(m => [
            m.unread ? color("blue", "●") : " ",
            color("cyan", m.from?.email ?? m.from?.name ?? "?"),
            (m.subject ?? "(no subject)").slice(0, 60),
            m.internalDate ? formatDate(new Date(m.internalDate).toISOString()) : "-",
          ]),
        );
        console.log(color("dim", `${r.messages.length} message(s)${r.nextPageToken ? " — more available" : ""}`));
        return;
      }
      if (sub === "show") {
        const id = rest[1];
        if (!id) throw new Error("message id required");
        const m = await client.gmail.get(id);
        console.log(color("cyan", (m.subject ?? "(no subject)")));
        console.log(`  From: ${m.from?.name ?? ""} <${m.from?.email ?? ""}>`);
        if (m.to?.length) console.log(`  To: ${m.to.map(a => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ")}`);
        console.log(`  Date: ${m.internalDate ? new Date(m.internalDate).toLocaleString() : "-"}`);
        console.log();
        console.log(m.textPlain || m.textHtml || "(empty body)");
        return;
      }
      if (sub === "send") {
        const { values } = parseArgs({ args: rest.slice(1), options: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          html: { type: "string" },
          cc: { type: "string" },
        }, strict: true });
        if (!values.to || !values.subject || !values.body) {
          throw new Error("--to, --subject, and --body are required");
        }
        let htmlBody: string | undefined;
        if (values.html) {
          try { htmlBody = readFileSync(values.html, "utf8"); } catch { htmlBody = values.html; }
        }
        const sent = await client.gmail.send({
          to: values.to, subject: values.subject, body: values.body, htmlBody,
          cc: values.cc,
        });
        console.log(color("green", `✓ Sent (id: ${sent.id})`));
        return;
      }
      if (sub === "unread") {
        const n = await client.gmail.unreadCount();
        console.log(`${color("blue", String(n))} unread message(s)`);
        return;
      }
      throw new Error(`Unknown gmail command: ${sub}`);
    }

    case "gitlab": {
      const gl = getGitLabClient();
      const sub = rest[0];
      if (sub === "projects") {
        const { values } = parseArgs({ args: rest.slice(1), options: { search: { type: "string" } }});
        const projs = await gl.projects.list({ search: values.search });
        printTable(
          ["Project", "Visibility", "Stars", "Issues", "Updated"],
          projs.map(p => [
            color("cyan", p.path_with_namespace),
            p.visibility,
            String(p.star_count),
            String(p.open_issues_count),
            formatDate(p.last_activity_at),
          ]),
        );
        return;
      }
      if (sub === "project") {
        const id = rest[1]; if (!id) throw new Error("project id required");
        const p = await gl.projects.get(id);
        console.log(color("cyan", p.path_with_namespace));
        if (p.description) console.log(p.description);
        console.log(`  URL:      ${p.web_url}`);
        console.log(`  Default:  ${p.default_branch}`);
        console.log(`  Visibility: ${p.visibility}  Stars: ${p.star_count}  Forks: ${p.forks_count}  Open issues: ${p.open_issues_count}`);
        console.log(`  SSH:      ${p.ssh_url_to_repo}`);
        return;
      }
      if (sub === "issues") {
        const id = rest[1]; if (!id) throw new Error("project id required");
        const { values } = parseArgs({ args: rest.slice(2), options: { state: { type: "string", default: "opened" } }});
        const issues = await gl.issues.list(id, { state: values.state as any });
        printTable(
          ["#", "State", "Title", "Author", "Comments", "Updated"],
          issues.map(i => [
            color("cyan", `#${i.iid}`),
            i.state === "opened" ? color("green", "opened") : color("red", "closed"),
            i.title.slice(0, 60),
            i.author.username,
            String(i.user_notes_count),
            formatDate(i.updated_at),
          ]),
        );
        return;
      }
      if (sub === "mr") {
        const id = rest[1]; if (!id) throw new Error("project id required");
        const { values } = parseArgs({ args: rest.slice(2), options: { state: { type: "string", default: "opened" } }});
        const mrs = await gl.mergeRequests.list(id, { state: values.state as any });
        printTable(
          ["#", "State", "Title", "Author", "Branch", "Updated"],
          mrs.map(m => [
            color("cyan", `!${m.iid}`),
            m.state === "merged" ? color("purple", "merged")
              : m.draft || m.work_in_progress ? color("gray", "draft")
              : m.state === "opened" ? color("green", "opened") : color("red", m.state),
            m.title.slice(0, 55),
            m.author.username,
            `${m.source_branch} → ${m.target_branch}`,
            formatDate(m.updated_at),
          ]),
        );
        return;
      }
      if (sub === "pipelines") {
        const id = rest[1]; if (!id) throw new Error("project id required");
        const { values } = parseArgs({ args: rest.slice(2), options: { ref: { type: "string" } }});
        const pipes = await gl.pipelines.list(id, { ref: values.ref });
        printTable(
          ["ID", "Status", "Ref", "SHA", "Source", "Updated"],
          pipes.map(p => [
            color("cyan", `#${p.iid}`),
            p.status === "success" ? color("green", p.status)
              : p.status === "failed" || p.status === "canceled" ? color("red", p.status)
              : p.status === "running" ? color("blue", p.status)
              : color("yellow", p.status),
            p.ref,
            p.sha.slice(0, 8),
            p.source,
            formatDate(p.updated_at),
          ]),
        );
        return;
      }
      throw new Error(`Unknown gitlab command: ${sub}`);
    }

    default:
      throw new Error(`Unknown command: ${cmd}. Run '2pro help'.`);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

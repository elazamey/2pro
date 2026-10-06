# 2pro — GitHub Integration Toolkit

`2pro` is a TypeScript monorepo that bundles a full GitHub integration stack:

| Package | Path | Purpose |
|---|---|---|
| **SDK** | [`packages/sdk/`](./packages/sdk) | TypeScript client wrapping the GitHub REST + GraphQL API (repos, issues, PRs, Actions, users, with pagination and proper error types). |
| **CLI** | [`packages/cli/`](./packages/cli) | A small, dependency-free command-line tool (`2pro` / `gh2`) for repos, issues, PRs, Actions, **Figma design tokens and code generation** on the terminal. |
| **Dashboard** | [`apps/dashboard/`](./apps/dashboard) | A web dashboard (Express + vanilla SPA) that lets you browse repos, manage issues/PRs, monitor/re-run/cancel Actions runs, **and extract design tokens / generate code from Figma files** in the browser. Supports GitHub OAuth sign-in. |
| **Figma** | [`packages/figma/`](./packages/figma) | Figma REST API client, design-token extractor (colors/typography/spacing/radii → CSS/Tailwind theme), and HTML+Tailwind code generator from Figma frames. |
| **Google** | [`packages/google/`](./packages/google) | Google Workspace client (**Drive** + **Gmail**) on top of `googleapis`, with OAuth 2.0 helpers for CLI & web and an encrypted-file token store. |
| **GitLab** | [`packages/gitlab/`](./packages/gitlab) | GitLab REST API v4 client (**projects, issues, merge requests, pipelines**), supports self-hosted instances via `GITLAB_API_URL`. |
| **GitHub Action — label-sync** | [`actions/label-sync/`](./actions/label-sync) | Reusable Action that declaratively syncs issue/PR labels on a repo from a JSON/YAML config. |
| **GitHub Action — auto-label-pr** | [`actions/auto-label-pr/`](./actions/auto-label-pr) | Reusable Action that auto-labels PRs by path globs, draft state, size, authors, and branches. |

All packages share the same core SDKs, so behavior is consistent across CLI, web, and CI.

## Quick start

```bash
# Install deps + build all packages
npm install
npm run build

# Authenticate (any of):
export GITHUB_TOKEN=ghp_xxx       # or gh auth login (CLI reads ~/.config/gh/hosts.yml)

# CLI
npx 2pro auth status
npx 2pro repos list
npx 2pro issues list owner/repo --state open
npx 2pro pr create owner/repo --title "Fix" --head fix-1 --base main
npx 2pro actions runs owner/repo

# Web dashboard
npm run dev:dashboard            # http://localhost:3000

# Build the label-sync action (produces a single bundled dist/index.js)
npm run build -w @2pro/action-label-sync
```

## Authentication

The SDK picks up credentials in this order:
1. `token` option passed to the constructor.
2. `GITHUB_TOKEN` environment variable.
3. `GH_TOKEN` environment variable.
4. (CLI only) `oauth_token` from `~/.config/gh/hosts.yml` (the official `gh` CLI config).
5. (Dashboard) per-user OAuth session cookie from the **Sign in with GitHub** flow.

For **GitHub Enterprise Server**, pass `baseUrl: "https://github.mycompany.com/api/v3"` (SDK) or set `GITHUB_API_URL`.

### Corporate proxies / custom CAs

If your network intercepts TLS (common in corporate sandboxes), point Node at the proxy CA instead of disabling verification:

```bash
export NODE_EXTRA_CA_CERTS=/path/to/proxy-ca.pem
```

The codebase never sets `NODE_TLS_REJECT_UNAUTHORIZED` and never modifies TLS settings at runtime.

## GitHub Actions included

Two production-ready actions are bundled:

- [`actions/label-sync`](./actions/label-sync) — declaratively sync repo labels from a JSON/YAML config (create/update/rename/prune).
- [`actions/auto-label-pr`](./actions/auto-label-pr) — automatically label PRs by path globs, draft state, size, authors, and branches.

See each action's README and `example/` folder.

## Figma integration + MCP

2pro ships with first-class Figma support:

- [`packages/figma`](./packages/figma) — a TypeScript toolkit to talk to Figma's REST API, extract design tokens, and emit HTML + Tailwind CSS from frames.
- `2pro figma tokens <url-or-key>` — CLI command to dump colors/typography/spacing/radii as `pretty`, `css`, `tailwind` (theme snippet), or `json`.
- `2pro figma code <url-or-key> [--out file.html]` — generates a standalone HTML document with Tailwind CDN from a Figma frame.
- The dashboard's **Figma** tab lets you paste a Figma URL and switch between a swatches preview, CSS variables, a Tailwind config snippet, raw JSON, or a live-rendered preview of the generated code in an iframe.

### Google Drive & Gmail

Set up an OAuth 2.0 Client ID in Google Cloud Console, enable the Drive and Gmail APIs, then:

- CLI:
  ```bash
  export GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy
  2pro google login                       # opens browser → localhost OAuth callback
  2pro drive list                         # recent files
  2pro drive search "Q3 report"           # search by name
  2pro drive upload ./file.pdf --name "Report.pdf"
  2pro gmail list --unread                # list unread threads
  2pro gmail send --to a@b.co --subject Hi --body "Hello"
  ```
- Dashboard: a **Workspace** tab shows a **Connect Google Account** button (same OAuth flow), then displays recent Gmail threads with unread counts and a Drive search panel. Credentials are encrypted in the session cookie alongside the GitHub token.

See [`packages/google/README.md`](./packages/google/README.md) for full setup steps.

### GitLab

2pro speaks to GitLab (SaaS or self-hosted) using Personal Access Tokens.

```bash
export GITLAB_TOKEN=glpat-xxxxxxxxxxxx
# optional for self-hosted:
export GITLAB_API_URL=https://gitlab.mycompany.com/api/v4

2pro gitlab projects                  # list your projects
2pro gitlab issues mygroup/myproject  # open issues
2pro gitlab mr mygroup/myproject      # open merge requests
2pro gitlab pipelines mygroup/myproject
```

The dashboard's **GitLab** tab prompts for your token once, stores it encrypted in the session cookie, and provides a projects/issues/MRs/pipelines browser parallel to GitHub.

### MCP (Model Context Protocol)

For AI agents (celia_agent, Claude Desktop, Cursor, Cline, Windsurf, …), this repo also includes an [`mcp.json`](./mcp.json) that boots the official `@modelcontextprotocol/server-figma` so agents can read Figma files directly.

Set-up:

1. Create a **Personal Access Token** at <https://www.figma.com/settings> (Account → Personal access tokens).
2. Export it in your shell:
   ```bash
   export FIGMA_ACCESS_TOKEN=figd_xxxxxxxxxxxxxxxxxxxx
   ```
3. Point your MCP client at `mcp.json`. The CLI and dashboard use the same token directly via `@2pro/figma`, so MCP is an additional integration path for AI agents — not a runtime requirement.

## Project layout

```
2pro/
├── packages/
│   ├── sdk/        # @2pro/sdk       — core TS client
│   └── cli/        # @2pro/cli       — 2pro / gh2 binary
├── apps/
│   └── dashboard/  # @2pro/dashboard — Express + SPA web UI
└── actions/
    └── label-sync/ # reusable GitHub Action (bundled, no install needed at runtime)
```

## License

MIT.

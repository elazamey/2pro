# @2pro/cli — `2pro` / `gh2`

A small command-line client for GitHub (repos, issues, PRs, Actions) built on `@2pro/sdk`.

## Auth

```bash
export GITHUB_TOKEN=ghp_xxx
# or use the official gh CLI:  gh auth login
```

## Commands

```
2pro auth status
2pro repos list [--user <u>] [--org <o>] [--sort updated|created|pushed|full_name]
2pro repos get owner/repo
2pro repos create <name> [--private] [--desc "..."] [--org <org>] [--auto-init] [--homepage <url>]
2pro issues list owner/repo [--state open|closed|all]
2pro issues show owner/repo <number>
2pro issues create owner/repo --title "..." [--body "..."] [--label bug]... [--assignee user]...
2pro issues close owner/repo <number>
2pro pr list owner/repo [--state open|closed|all]
2pro pr show owner/repo <number>
2pro pr create owner/repo --title "..." --head <branch> --base main [--body "..."] [--draft]
2pro pr merge owner/repo <number> [--method merge|squash|rebase]
2pro actions runs owner/repo [--branch <b>] [--status queued|in_progress|completed]
2pro actions jobs owner/repo <run-id>
2pro actions rerun owner/repo <run-id>
2pro actions cancel owner/repo <run-id>
2pro workflows list owner/repo
```

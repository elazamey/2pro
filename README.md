# ⚡ 2pro

**One toolkit for GitHub.** A typed Python SDK, a friendly CLI, a live dashboard and
ready-to-run CI automation — all sharing a single, carefully built HTTP core.

Read and write repositories, issues, pull requests and Actions runs from your
terminal, from Python, or from a browser.

```console
$ 2pro auth status
Host               github.com
Authenticated as   elazamey - sayed_elazamy
Token              ghp_************oken
Source             environment
Scopes             repo, read:org, workflow
Rate limit         7945/7950 left, resets in 3496s

$ 2pro run list elazamey/edu --limit 3
Run id   Workflow      Event        Branch          Status       Result    Duration  Started
371245…  Repository c… pull_reque…  arena/01a0fe…   ✅ complete  success   45s       2026-10-03
```

---

## Contents

- [Why 2pro](#why-2pro)
- [Install](#install)
- [Authentication](#authentication)
- [CLI](#cli)
- [Python SDK](#python-sdk)
- [Dashboard](#dashboard)
- [CI automation](#ci-automation)
- [GitHub Actions workflows](#github-actions-workflows)
- [Configuration](#configuration)
- [Development](#development)
- [Project layout](#project-layout)

---

## Why 2pro

| Layer | What you get |
| --- | --- |
| **SDK** (`twopro`) | Typed models (pydantic v2), automatic pagination, retries with `Retry-After` support, conditional (`ETag`) requests, GraphQL escape hatch |
| **CLI** (`2pro`) | 40+ commands with `table` / `json` / `yaml` / `csv` output for humans and pipelines |
| **Dashboard** (`2pro serve`) | A zero-build web UI for issues, PRs and Actions — the token never leaves the server |
| **Automation** (`2pro automate`) | Labeling, stale sweeps, activity digests and automated reviews you can drop into CI |

One credential chain, one rate-limit budget, one place to fix things.

## Install

```bash
pip install twopro            # SDK + CLI
pip install "twopro[web]"     # + dashboard (FastAPI + uvicorn)
```

From source:

```bash
git clone https://github.com/elazamey/2pro.git
cd 2pro
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev,web]"
pytest
```

Requires **Python 3.10+**.

## Authentication

2pro resolves a credential automatically, in this order:

1. `--token` on the command line (or `token=` in Python)
2. `GITHUB_TOKEN` / `GH_TOKEN` / `GH_ENTERPRISE_TOKEN` (a local `.env` file is loaded too)
3. the token stored by `2pro auth login`
4. the credential of the installed [`gh` CLI](https://cli.github.com) (`gh auth token`, then `hosts.yml`)

```bash
2pro auth status          # who am I, which token, how much budget is left
2pro auth whoami          # just the login - handy in scripts
2pro auth token --show    # print the resolved token
2pro auth logout          # forget the stored token
```

For tools you ship to other people, use the OAuth **device flow** — it needs only an
OAuth App client id:

```bash
export TWOPRO_OAUTH_CLIENT_ID=Iv1.xxxxxxxxxxxx
2pro auth login --scope "repo read:org workflow"
# → open https://github.com/login/device and enter the code shown
```

Check connectivity any time with `2pro auth test`.

## CLI

```console
$ 2pro --help
```

Global options: `--token`, `--hostname` (GitHub Enterprise), `-f/--format`
(`table|json|yaml|csv`), `--no-color`, `-v/--verbose`, `-V/--version`.

### Repositories

```bash
2pro repo list --mine --limit 20          # or --org acme / --user octocat
2pro repo view elazamey/2pro
2pro repo create my-tool --org acme --private --init
2pro repo topics elazamey/2pro
2pro repo releases elazamey/2pro
2pro repo branches elazamey/2pro
2pro repo readme elazamey/2pro
2pro repo search "language:python stars:>1000"
2pro repo edit elazamey/2pro --description "..." --private --archive
2pro repo secrets elazamey/2pro          # Actions secret names (never the values)
2pro repo clone elazamey/2pro --depth 1  # uses `gh` when installed, else git
```

### Issues

```bash
2pro issue list elazamey/2pro --state open --label bug
2pro issue list --mine                     # across every repository
2pro issue view elazamey/2pro 42 --comments
2pro issue create elazamey/2pro --title "Crash on empty input" \
                  --body-file report.md --label bug
2pro issue comment elazamey/2pro 42 --body "Reproduced on main"
2pro issue close elazamey/2pro 42 --reason not_planned --comment "wontfix"
2pro issue label elazamey/2pro 42 --add "needs-triage,bug" --remove duplicate
2pro issue edit elazamey/2pro 42 --title "Crash on empty input" --assignee octocat
```

### Pull requests

```bash
2pro pr list elazamey/2pro --state open --base main
2pro pr checks elazamey/2pro 7             # commit statuses + workflow runs
2pro pr files elazamey/2pro 7
2pro pr reviews elazamey/2pro 7
2pro pr review elazamey/2pro 7 --approve --body "LGTM"
2pro pr merge elazamey/2pro 7 --method squash --yes
2pro pr create elazamey/2pro --title "feat(api): add paging" --head feat --base main
2pro pr edit elazamey/2pro 7 --base develop --title "feat(api): add paging + sort"
```

### Actions

```bash
2pro run list elazamey/2pro --workflow ci.yml --status completed
2pro run view elazamey/2pro 371245 --jobs
2pro run watch elazamey/2pro 371245        # follow until it finishes (exit code = CI result)
2pro run rerun elazamey/2pro 371245 --failed
2pro run cancel elazamey/2pro 371245
2pro run logs elazamey/2pro 371245 --out logs.zip
2pro run artifacts elazamey/2pro 371245 --download ./artifacts
2pro run dispatch elazamey/2pro ci.yml --ref main --input env=prod
2pro workflow list elazamey/2pro
```

### Organisations and account

```bash
2pro org list
2pro org repos acme --limit 50
2pro org members acme --role admin
2pro me
2pro rate-limit
2pro graphql 'query { viewer { login } }'
```

Every command speaks JSON, YAML and CSV, so it composes:

```bash
2pro --format json repo list --mine | jq -r '.[].full_name'
2pro --format csv issue list elazamey/2pro > issues.csv
```

## Python SDK

```python
from twopro import GitHub

gh = GitHub()  # token from env / `gh` CLI / stored login

for repo in gh.repos.list_for_authenticated_user(max_items=50):
    print(repo.full_name, repo.stargazers_count, repo.language)
```

The API mirrors GitHub's own structure:

```python
# repositories
repo = gh.repos.get("elazamey", "2pro")
gh.repos.create("new-service", org="acme", private=True, auto_init=True)
gh.repos.topics("elazamey", "2pro")

# issues (comments work for pull requests too - GitHub treats a PR as an issue)
issue = gh.issues.create("elazamey", "2pro", "Broken link", body="...", labels=["bug"])
gh.issues.comment("elazamey", "2pro", issue.number, "Thanks, fixing now")
gh.issues.close("elazamey", "2pro", issue.number, reason="completed")

# pull requests
pr = gh.pulls.get("elazamey", "2pro", 7)
print(pr.additions, pr.deletions, pr.mergeable, pr.is_merged)
gh.pulls.merge("elazamey", "2pro", 7, method="squash")
gh.pulls.create_review("elazamey", "2pro", 7, event="APPROVE", body="LGTM")

# actions
run = gh.actions.latest_run("elazamey", "2pro", branch="main")
print(run.icon, run.conclusion, run.duration_seconds)
gh.actions.rerun("elazamey", "2pro", run.id, failed_only=True)
gh.actions.logs("elazamey", "2pro", run.id)  # bytes (a zip archive)
gh.actions.dispatch("elazamey", "2pro", "ci.yml", ref="main", inputs={"env": "prod"})

# search, users, orgs - and the repo shortcut
for hit in gh.search.repositories("org:elazamey language:python"):
    print(hit.full_name)
gh.repo("elazamey/2pro").runs(branch="main")
```

Nice details from the core client, all used automatically:

```python
gh.client.rate_limit_status(refresh=True)  # RateLimit(limit=5000, remaining=4321, ...)
gh.client.paginate("/user/repos")  # follows Link headers for you
gh.client.get("/repos/a/b", use_cache=True)  # ETag/304 conditional requests
gh.client.graphql("query { viewer { login } }")
```

Errors are typed, so you can react precisely:

```python
from twopro import GitHub, NotFoundError, RateLimitError

try:
    gh.repos.get("elazamey", "nope")
except NotFoundError as exc:
    print("missing:", exc.status_code, exc.documentation_url)
except RateLimitError as exc:
    print(f"slow down, resets in {exc.wait_seconds:.0f}s")
```

## Dashboard

```bash
2pro serve                    # http://0.0.0.0:8000
2pro serve --port 9000 --open
```

A single-page control room with **no build step** (vanilla JS + CSS):

- repository picker with search, private/public and language metadata
- **Issues** — browse, create, comment, close (with a reason)
- **Pull requests** — view, merge (merge/squash/rebase), run the automated review
- **Actions** — runs with live status, re-run (all or failed jobs), cancel, and dispatch a `workflow_dispatch` run straight from the UI
- **Digest** — markdown activity report rendered in place
- rate-limit meter in the header, optional 30s auto-refresh
- full command reference in [`docs/CLI.md`](docs/CLI.md)

The browser only ever talks to `/api/*` on the same origin; the credential stays on
the server. Interactive OpenAPI docs are at `/docs`.

## CI automation

Everything defaults to a **dry run** and prints markdown, so you can pipe it into
`$GITHUB_STEP_SUMMARY`.

```bash
# conventional-commit + size labels ("feat(api): …", 312 lines → type/feature, size/M)
2pro automate label elazamey/2pro 7 --dry-run
2pro automate label elazamey/2pro 7 --apply --create-missing

# deterministic review checklist: description, linked issue, size, tests, secrets, CI
2pro automate review elazamey/2pro 7            # exits 1 on blockers
2pro automate review elazamey/2pro 7 --post --apply

# mark idle issues stale, close the ones that stayed stale
2pro automate stale elazamey/2pro --days 60 --close-days 14 --dry-run

# markdown activity digest (merged PRs, issues, failing runs, top contributors)
2pro automate digest elazamey/2pro --days 7 --out digest.md
```

## GitHub Actions workflows

This repository ships the workflows it preaches:

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | push / PR | `ruff check`, `ruff format --check`, pytest on Python 3.10–3.12, build + smoke-test the wheel |
| `release.yml` | tag `v*.*.*` | builds sdist/wheel, publishes to PyPI via trusted publishing, creates the GitHub release |
| `automation.yml` | PR, daily, weekly | labels PRs, posts automated reviews, publishes a digest, sweeps stale issues — using `2pro automate` |
| `pr-title.yml` | PR | enforces Conventional Commit titles |

The automation workflow is a copy-paste starting point for your own repository:
change the cron, flip `--dry-run` to `--apply`, done.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` / `GH_TOKEN` / `GH_ENTERPRISE_TOKEN` | – | credential |
| `GITHUB_HOSTNAME` | `github.com` | GitHub Enterprise host (`https://HOST/api/v3`) |
| `GITHUB_API_URL` | `https://api.github.com` | full API override |
| `TWOPRO_PER_PAGE` | `100` | page size for collection endpoints |
| `TWOPRO_TIMEOUT` | `30` | request timeout (seconds) |
| `TWOPRO_MAX_RETRIES` | `3` | retries on 5xx / 429 |
| `TWOPRO_WAIT_ON_RATE_LIMIT` | `false` | sleep until the quota resets instead of raising |
| `TWOPRO_CA_BUNDLE` | – | custom CA bundle (corporate proxy, private GHE cert) |
| `TWOPRO_VERIFY_SSL` | `true` | TLS verification |
| `TWOPRO_HOST` / `TWOPRO_PORT` | `0.0.0.0` / `8000` | dashboard bind address |
| `TWOPRO_OAUTH_CLIENT_ID` | – | default client id for `2pro auth login` |

Copy `.env.example` to `.env` — it is loaded automatically.

## Development

```bash
pip install -e ".[dev,web]"
pytest                       # 318 hermetic tests, no network access
pytest --cov=twopro --cov-report=term-missing
ruff check . && ruff format .
2pro serve                   # hack on the dashboard with a live preview
```

The test suite replays canned GitHub responses through an `httpx.MockTransport`, so
it is fast, hermetic and never touches your API quota.

## Project layout

```
src/twopro/
├── client.py        # HTTP core: auth, retries, pagination, ETag cache, GraphQL
├── models.py        # typed pydantic models for every resource
├── auth.py          # credential chain, stored tokens, OAuth device flow
├── config.py        # environment / .env settings
├── errors.py        # typed exceptions
├── github.py        # the GitHub facade + RepoHandle shortcut
├── resources/       # repos, issues, pulls, actions, users, orgs, search
├── cli/             # the `2pro` command (typer + rich)
├── web/             # FastAPI dashboard (app.py + static/)
└── automation/      # labeler, stale sweep, digest, review
.github/workflows/   # CI, release, repo automation, PR title check
tests/               # hermetic tests over a mock GitHub API
```

## License

[MIT](LICENSE) © elazamey

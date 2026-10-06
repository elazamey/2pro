# `auto-label-pr` Action

Automatically labels a pull request based on which files were changed, whether
it's a draft, its size (additions/deletions/files), author, and head/base
branch patterns. Ships with a sensible default config (frontend/backend/docs/
ci/tests/dependencies/config/draft/large/small) and supports fully custom
`.github/auto-label.yml` configs.

## Inputs

| Name           | Default                             | Description                                                                 |
|----------------|-------------------------------------|-----------------------------------------------------------------------------|
| `github-token` | `${{ github.token }}`               | Token; needs `pull-requests: write`                                         |
| `repo`         | `${{ github.repository }}`          | Target repo                                                                 |
| `pr-number`    | (from `pull_request` event)         | Explicit PR number                                                          |
| `config-path`  | `.github/auto-label.yml`            | Config file (YAML or JSON). If missing, sensible defaults are used.         |
| `dry-run`      | `false`                             | Log changes without applying them                                           |
| `add-labels`   | `""`                                | Comma-separated labels to *always* add (e.g. `needs-review`)                |

## Outputs

* `added` — comma-separated list of newly added labels
* `removed` — comma-separated list of removed labels
* `summary` — human-readable summary

## Example config

```yaml
frontend:
  paths:
    - "client/**"
    - "src/**/*.{tsx,jsx,css}"
  remove_on_no_match: true

backend:
  paths:
    - "server/**"
    - "api/**"

draft:
  drafts: true
  remove_on_no_match: true

large:
  min_additions: 500
  remove_on_no_match: true
```

### Rule fields

* `paths` — list of globs. `*` = within a dir, `**` = across dirs, `{a,b}` = brace alternatives, `?` = any char.
* `drafts: true|false` — apply only to drafts / only to non-drafts.
* `base_branches: [...]` / `head_branches: [...]` — only apply on matching base/head branches (supports glob via `*` in branch names, e.g. `hotfix/**`).
* `authors: [...]` — only apply when opened by specific users.
* `min_additions`, `max_additions`, `min_deletions`, `max_deletions`, `max_changed_files` — size thresholds.
* `remove_on_no_match: true` — remove the label if the rule stops matching
  (e.g. a PR leaves draft state, or a WIP prefix is removed from the title by
  amending files).

## Defaults

If no config file is present, the action uses a built-in default covering
`frontend`, `backend`, `docs`, `ci`, `tests`, `dependencies`, `config`,
and `draft` (meta-rule for draft PRs).

# `label-sync` Action

A GitHub Action that declaratively syncs issue & pull-request labels on a
repository from a config file (JSON or simple YAML). It creates missing labels,
updates changed colors/descriptions, renames aliases, and (optionally) prunes
labels that are no longer defined.

## Inputs

| Name            | Default                     | Description                                                            |
|-----------------|-----------------------------|------------------------------------------------------------------------|
| `github-token`  | `${{ github.token }}`       | Token with write access to labels                                      |
| `config-path`   | `.github/labels.json`       | Path to labels config (`.json`, `.yml`, or `.yaml`)                    |
| `repo`          | `${{ github.repository }}`  | Target `owner/repo`                                                    |
| `dry-run`       | `false`                     | If `true`, log planned changes without applying them                   |
| `prune`         | `true`                      | If `false`, don't delete labels that are missing from the config       |

## Outputs

* `summary` — `created=N updated=N deleted=N dryRun=...`
* `created`, `updated`, `deleted` — integer counts

## Config format (`labels.json`)

```json
{
  "labels": [
    { "name": "bug", "color": "d73a4a", "description": "Something isn't working" },
    { "name": "enhancement", "color": "a2eeef", "alias": ["feature"] }
  ]
}
```

Fields:

* `name` — label name (required)
* `color` — hex color, with or without `#` (required)
* `description` — optional label description
* `alias` — optional array of old label names that should be **renamed** to this one
  (instead of being deleted/duplicated).

## Example workflow

See [`example/workflow.yml`](./example/workflow.yml).

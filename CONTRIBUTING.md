# Contributing to 2pro

Thanks for helping out. This is a small, focused codebase: one HTTP core with
four thin layers on top (SDK → CLI → dashboard → automation). If you add
something, add it where it belongs so all four layers benefit.

## Setup

```bash
git clone https://github.com/elazamey/2pro.git
cd 2pro
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev,web]"
pytest
```

## Before you open a pull request

```bash
ruff check .
ruff format .
pytest --cov=twopro
```

CI runs the same three things on Python 3.10, 3.11 and 3.12.

## Where does my change go?

| Change | File(s) |
| --- | --- |
| A new GitHub endpoint | `src/twopro/resources/*.py` + a model in `models.py` |
| A new subcommand | `src/twopro/cli/*.py`, registered in `cli/main.py` |
| A new dashboard panel | `src/twopro/web/app.py` (endpoint) + `web/static/app.js` (UI) |
| A new CI helper | `src/twopro/automation/*.py` + a `cli/automate.py` command |
| HTTP behaviour (retries, pagination, caching) | `src/twopro/client.py` — fix it once for everyone |

## Conventions

- **Typed everything.** Public functions carry annotations and a one-line docstring.
- **Errors are typed.** Raise or map to a class from `errors.py`; never swallow an
  API error into `None` without documenting it.
- **Writes are explicit.** Every automation helper takes `dry_run` and defaults to
  `True`. Destructive CLI commands ask for confirmation.
- **No network in tests.** Tests use the `MockAPI` helper in `tests/conftest.py`
  over an `httpx.MockTransport`. If your test needs a new endpoint, add a canned
  response instead of calling GitHub.
- **Output formats.** New list commands should render through
  `ctx.obj.out.rows(...)` so `--format` works for free.
- **Conventional Commits** for titles (`feat:`, `fix:`, `docs:`, `chore:`, ...);
  `pr-title.yml` enforces it.

## Adding a resource method

```python
# src/twopro/resources/repos.py
def stars(self, owner: str, repo: str) -> int:
    """Total stargazers - one call, no pagination needed."""
    return self._client.get(f"/repos/{owner}/{repo}")["stargazers_count"]
```

Then:

1. add a test in `tests/test_resources.py` with a canned response,
2. expose it from the CLI only if a human would type it,
3. mention it in the README if it changes the public surface.

## Reporting bugs

Open an issue with the command you ran, the output (`2pro --version`, traceback)
and what you expected. `2pro auth status` output is almost always helpful.

## Releasing

```bash
# bump src/twopro/_version.py, commit, then:
git tag v0.1.1 && git push origin v0.1.1
```

`release.yml` builds the distributions, publishes to PyPI with trusted
publishing and creates the GitHub release.

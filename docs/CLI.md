# CLI reference

> Generated from `2pro --help` for version 0.1.0.

```
                                                                                                    
 Usage: 2pro [OPTIONS] COMMAND [ARGS]...                                                            
                                                                                                    
 2pro - one toolkit for GitHub: read and write repositories, issues, pull requests and Actions      
 runs, from the terminal, from Python or from a live dashboard.                                     
                                                                                                    
 Auth is resolved automatically from GITHUB_TOKEN, `2pro auth login` or the                         
 GitHub CLI.                                                                                        
                                                                                                    
╭─ Options ────────────────────────────────────────────────────────────────────────────────────────╮
│ --token               -t      <str>                  GitHub token (default: env / gh CLI /       │
│                                                      stored).                                    │
│ --hostname                    <str>                  GitHub Enterprise hostname, e.g.            │
│                                                      github.example.com.                         │
│ --format              -f      <table|json|yaml|csv>  Output format: table, json, yaml or csv.    │
│                                                      [default: table]                            │
│ --no-color                                           Disable colours and other ANSI styling.     │
│ --verbose             -v                             Print request errors with more detail.      │
│ --version             -V                             Show the 2pro version and exit.             │
│ --install-completion                                 Install completion for the current shell.   │
│ --show-completion                                    Show completion for the current shell, to   │
│                                                      copy it or customize the installation.      │
│ --help                                               Show this message and exit.                 │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Commands ───────────────────────────────────────────────────────────────────────────────────────╮
│ me          Show the authenticated user.                                                         │
│ rate-limit  Remaining API budget for this token.                                                 │
│ serve       Run the 2pro dashboard (FastAPI + a zero-build web UI).                              │
│ graphql     Run an arbitrary GraphQL query (the escape hatch for anything missing).              │
│ auth        Inspect and create credentials.                                                      │
│ repo        Repositories, branches, releases and topics.                                         │
│ issue       List, create, close and comment on issues.                                           │
│ pr          Pull requests: checks, reviews, merge.                                               │
│ run         Actions runs: watch, re-run, logs, artifacts.                                        │
│ workflow    Actions workflows in a repository.                                                   │
│ org         Organisations, members and repositories.                                             │
│ automate    Repo automation for CI: labels, stale, digest.                                       │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
                                                                                                    
 Examples                                                                                           
   2pro auth status                     # who am I and how many calls are left                      
   2pro repo list --mine --limit 20                                                                 
   2pro issue list elazamey/2pro --state open                                                       
   2pro pr checks elazamey/2pro 3                                                                   
   2pro run watch elazamey/2pro 123456  # follow a workflow run                                     
   2pro serve                           # open the dashboard                                        
                                                                                                    

```

## `2pro auth`

```
                                                                                                    
 Usage: 2pro auth [OPTIONS] COMMAND [ARGS]...                                                       
                                                                                                    
 Inspect and create credentials.                                                                    
                                                                                                    
╭─ Options ────────────────────────────────────────────────────────────────────────────────────────╮
│ --help          Show this message and exit.                                                      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Commands ───────────────────────────────────────────────────────────────────────────────────────╮
│ status  Where the token comes from, who it belongs to, and the budget left.                      │
│ token   Print the resolved token (masked unless --show).                                         │
│ whoami  Just the login - handy in shell scripts.                                                 │
│ login   Log in with the OAuth device flow (needs only an OAuth App client id).                   │
│ logout  Delete the token stored by ``2pro auth login``.                                          │
│ test    Make one real call and report what the credential can do.                                │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯

```

## `2pro repo`

```
                                                                                                    
 Usage: 2pro repo [OPTIONS] COMMAND [ARGS]...                                                       
                                                                                                    
 Repositories, branches, releases and topics.                                                       
                                                                                                    
╭─ Options ────────────────────────────────────────────────────────────────────────────────────────╮
│ --help          Show this message and exit.                                                      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Commands ───────────────────────────────────────────────────────────────────────────────────────╮
│ list      List repositories for a user, an organisation or yourself.                             │
│ view      Show one repository in detail.                                                         │
│ create    Create a repository.                                                                   │
│ delete    Delete a repository (irreversible).                                                    │
│ branches  List branches.                                                                         │
│ releases  List releases.                                                                         │
│ topics    Show repository topics.                                                                │
│ readme    Print the README.                                                                      │
│ search    Search repositories (search API: 30 requests/minute).                                  │
│ edit      Change repository settings (only the flags you pass are sent).                         │
│ secrets   List Actions secret names (values are never returned by the API).                      │
│ clone     Clone a repository with `gh` (falling back to plain git).                              │
│ open      Print the repository URL (or open it with --browser).                                  │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯

```

## `2pro issue`

```
                                                                                                    
 Usage: 2pro issue [OPTIONS] COMMAND [ARGS]...                                                      
                                                                                                    
 List, create, close and comment on issues.                                                         
                                                                                                    
╭─ Options ────────────────────────────────────────────────────────────────────────────────────────╮
│ --help          Show this message and exit.                                                      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Commands ───────────────────────────────────────────────────────────────────────────────────────╮
│ list      List issues (pull requests are excluded).                                              │
│ view      Show one issue.                                                                        │
│ create    Open a new issue.                                                                      │
│ edit      Edit an issue (title, body, labels, assignees).                                        │
│ close     Close an issue.                                                                        │
│ reopen    Reopen a closed issue.                                                                 │
│ comment   Add a comment to an issue (works for pull requests too).                               │
│ comments  List comments on an issue.                                                             │
│ label     Add or remove labels on an issue.                                                      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯

```

## `2pro pr`

```
                                                                                                    
 Usage: 2pro pr [OPTIONS] COMMAND [ARGS]...                                                         
                                                                                                    
 Pull requests: checks, reviews, merge.                                                             
                                                                                                    
╭─ Options ────────────────────────────────────────────────────────────────────────────────────────╮
│ --help          Show this message and exit.                                                      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Commands ───────────────────────────────────────────────────────────────────────────────────────╮
│ list     List pull requests.                                                                     │
│ view     Show one pull request.                                                                  │
│ create   Open a pull request.                                                                    │
│ edit     Edit a pull request.                                                                    │
│ merge    Merge a pull request.                                                                   │
│ close    Close a pull request without merging.                                                   │
│ files    Changed files with per-file additions/deletions.                                        │
│ checks   CI status for the head commit of a pull request.                                        │
│ reviews  Reviews submitted on a pull request.                                                    │
│ review   Submit a review (``--approve``, ``--request-changes``, or a plain comment).             │
│ comment  Comment on a pull request.                                                              │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯

```

## `2pro run`

```
                                                                                                    
 Usage: 2pro run [OPTIONS] COMMAND [ARGS]...                                                        
                                                                                                    
 Actions runs: watch, re-run, logs, artifacts.                                                      
                                                                                                    
╭─ Options ────────────────────────────────────────────────────────────────────────────────────────╮
│ --help          Show this message and exit.                                                      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Commands ───────────────────────────────────────────────────────────────────────────────────────╮
│ list       List workflow runs, newest first.                                                     │
│ view       Show one workflow run (and optionally its jobs).                                      │
│ watch      Follow a run until it finishes, then print the job summary.                           │
│ rerun      Re-run a workflow run.                                                                │
│ cancel     Cancel a running workflow run.                                                        │
│ logs       Download run logs (a zip) or a single job's log (text).                               │
│ artifacts  List artifacts of a run, optionally downloading them.                                 │
│ dispatch   Trigger a workflow_dispatch run.                                                      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯

```

## `2pro workflow`

```
                                                                                                    
 Usage: 2pro workflow [OPTIONS] COMMAND [ARGS]...                                                   
                                                                                                    
 Actions workflows in a repository.                                                                 
                                                                                                    
╭─ Options ────────────────────────────────────────────────────────────────────────────────────────╮
│ --help          Show this message and exit.                                                      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Commands ───────────────────────────────────────────────────────────────────────────────────────╮
│ list  List the workflows defined in a repository.                                                │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯

```

## `2pro org`

```
                                                                                                    
 Usage: 2pro org [OPTIONS] COMMAND [ARGS]...                                                        
                                                                                                    
 Organisations, members and repositories.                                                           
                                                                                                    
╭─ Options ────────────────────────────────────────────────────────────────────────────────────────╮
│ --help          Show this message and exit.                                                      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Commands ───────────────────────────────────────────────────────────────────────────────────────╮
│ list     Organisations you belong to.                                                            │
│ view     Show an organisation.                                                                   │
│ repos    Repositories in an organisation.                                                        │
│ members  Members of an organisation.                                                             │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯

```

## `2pro automate`

```
                                                                                                    
 Usage: 2pro automate [OPTIONS] COMMAND [ARGS]...                                                   
                                                                                                    
 Repo automation for CI: labels, stale, digest.                                                     
                                                                                                    
╭─ Options ────────────────────────────────────────────────────────────────────────────────────────╮
│ --help          Show this message and exit.                                                      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Commands ───────────────────────────────────────────────────────────────────────────────────────╮
│ label   Suggest and apply conventional-commit / size labels to a pull request.                   │
│ stale   Mark inactive issues stale and close the ones that stayed stale.                         │
│ digest  Build a markdown activity digest (merged PRs, issues, CI, contributors).                 │
│ review  Run the automated review checklist over a pull request.                                  │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯

```


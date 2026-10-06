# @2pro/gitlab

TypeScript client for GitLab REST API v4, covering projects, issues, merge requests, and pipelines. Works with `gitlab.com` and self-hosted GitLab instances (set `baseUrl` or `GITLAB_API_URL`).

## Usage

```ts
import { GitLab } from "@2pro/gitlab";

const gl = new GitLab({ token: process.env.GITLAB_TOKEN });
// For self-hosted:
// const gl = new GitLab({ token, baseUrl: "https://gitlab.mycompany.com/api/v4" });

const projects = await gl.projects.list({ search: "web" });
const issues = await gl.issues.list("mygroup/myproject", { state: "opened" });
const mrs = await gl.mergeRequests.list("mygroup/myproject", { state: "opened" });
const pipelines = await gl.pipelines.list("mygroup/myproject", { ref: "main" });
await gl.mergeRequests.merge("mygroup/myproject", 42);
await gl.pipelines.cancel("mygroup/myproject", 1234);
```

Project IDs can be numeric or URL-encoded `namespace/project` paths (`mygroup%2Fmyproject`); pass them as plain strings and the library encodes them automatically.

## CLI

```bash
export GITLAB_TOKEN=glpat-xxxxxxxxxxxx
# optional for self-hosted:
export GITLAB_API_URL=https://gitlab.mycompany.com/api/v4

2pro gitlab projects
2pro gitlab project mygroup/myproject
2pro gitlab issues mygroup/myproject
2pro gitlab mr mygroup/myproject
2pro gitlab pipelines mygroup/myproject
```

## Dashboard

The dashboard GitLab tab asks for your Personal Access Token once, stores it encrypted in the session cookie, and gives you a Projects browser plus Issues/MRs/Pipelines views (parallel to the GitHub tab).

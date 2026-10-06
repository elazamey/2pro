# @2pro/sdk

A small, dependency-free TypeScript client for the GitHub REST + GraphQL API.

## Install

```bash
npm install @2pro/sdk
```

## Usage

```ts
import { GitHub } from "@2pro/sdk";

const gh = new GitHub({ token: process.env.GITHUB_TOKEN });

// REST helpers
const me = await gh.users.me();
const repos = await gh.repos.list({ sort: "updated", perPage: 50 });
const issue = await gh.issues.create("owner", "repo", {
  title: "Bug report",
  body: "…",
  labels: ["bug"],
});
const pr = await gh.pulls.merge("owner", "repo", 42, { merge_method: "squash" });
const runs = await gh.actions.listRuns("owner", "repo", { branch: "main", status: "completed" });

// Raw request
const raw = await gh.request("/repos/owner/repo/releases");

// Pagination helpers (auto-follows Link: rel="next")
for await (const page of gh.paginate("/repos/owner/repo/issues")) {
  for (const issue of page) console.log(issue.title);
}
// or:
const all = await gh.collect("/repos/owner/repo/issues", { perPage: 100 });

// GraphQL
const { viewer } = await gh.graphql<{ viewer: { login: string } }>(
  `{ viewer { login } }`
);
```

## Enterprise Server

```ts
new GitHub({ token, baseUrl: "https://github.mycompany.com/api/v3" });
```

## Corporate proxies / custom TLS CAs

Node must trust your proxy's CA at the process level; the SDK does not modify TLS:

```bash
export NODE_EXTRA_CA_CERTS=/path/to/proxy-ca.pem
```

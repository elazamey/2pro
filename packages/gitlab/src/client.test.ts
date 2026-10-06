import { test } from "node:test";
import assert from "node:assert/strict";
import { GitLabClient, GitLabError } from "./client.js";

test("GitLabClient defaults to gitlab.com/api/v4", () => {
  const c = new GitLabClient({ token: "test-token" });
  assert.equal(c.baseUrl, "https://gitlab.com/api/v4");
});

test("GitLabClient respects baseUrl override for self-hosted", () => {
  const c = new GitLabClient({ token: "x", baseUrl: "https://gitlab.mycompany.com/api/v4/" });
  assert.equal(c.baseUrl, "https://gitlab.mycompany.com/api/v4");
});

test("GitLabClient.encodeProjectId URL-encodes namespaces", () => {
  assert.equal(GitLabClient.encodeProjectId("mygroup/myproject"), "mygroup%2Fmyproject");
  assert.equal(GitLabClient.encodeProjectId(42), "42");
});

test("GitLabError includes status", () => {
  const e = new GitLabError(404, "Not Found");
  assert.equal(e.status, 404);
  assert.match(e.message, /404/);
});

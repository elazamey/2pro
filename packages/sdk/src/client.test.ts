import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubClient, GitHubError } from "./client.js";

test("GitHubClient sets default base url", () => {
  const c = new GitHubClient({ token: "x" });
  assert.equal(c.token, "x");
});

test("GitHubError includes status", () => {
  const err = new GitHubError({ status: 404, message: "Not Found" });
  assert.equal(err.status, 404);
  assert.equal(err.message, "Not Found");
  assert.equal(err.name, "GitHubError");
});

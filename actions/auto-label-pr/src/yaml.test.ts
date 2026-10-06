import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYaml } from "./yaml.js";

test("parses a simple labels config", () => {
  const cfg = parseYaml(`
frontend:
  paths:
    - client/**
    - src/**/*.tsx
  remove_on_no_match: true

backend:
  paths: [server/**, api/**]
  max_additions: 1000

draft:
  drafts: true
  remove_on_no_match: true
`);
  assert.equal(cfg.rules.length, 3);
  assert.deepEqual(cfg.rules[0], { label: "frontend", paths: ["client/**", "src/**/*.tsx"], remove_on_no_match: true });
  assert.equal(cfg.rules[1].max_additions, 1000);
  assert.equal(cfg.rules[2].drafts, true);
});

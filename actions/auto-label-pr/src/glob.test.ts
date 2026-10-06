import { test } from "node:test";
import assert from "node:assert/strict";
import { matchAny, globToRegex } from "./glob.js";

test("matches tsx/jsx within src (brace expansion via matchAny)", () => {
  assert.ok(matchAny("src/components/App.tsx", ["src/**/*.{tsx,jsx}"]));
  assert.ok(matchAny("src/a/b/c.jsx", ["src/**/*.{tsx,jsx}"]));
  assert.ok(matchAny("src/App.tsx", ["src/**/*.{tsx,jsx}"]));
  assert.ok(!matchAny("server/app.tsx", ["src/**/*.{tsx,jsx}"]));
});

test("matches docs folder at root and nested", () => {
  assert.ok(matchAny("docs/readme.md", ["docs/**"]));
  assert.ok(matchAny("docs/a/b/c.md", ["docs/**"]));
  assert.ok(matchAny("packages/docs/readme.md", ["**/docs/**"]));
  assert.ok(matchAny("docs/readme.md", ["**/docs/**"]));
});

test("matches root-level config files only", () => {
  assert.ok(matchAny("package.json", ["*.json"]));
  assert.ok(matchAny("package-lock.json", ["*.json"]));
  assert.ok(!matchAny("src/foo.json", ["*.json"]));
});

test("matches workflows folder", () => {
  assert.ok(matchAny(".github/workflows/ci.yml", [".github/workflows/**"]));
});

test("matches nested test files", () => {
  assert.ok(matchAny("src/foo.test.ts", ["**/*.test.*"]));
  assert.ok(matchAny("__tests__/foo.ts", ["__tests__/**"]));
  assert.ok(matchAny("tests/unit/foo.js", ["tests/**"]));
  assert.ok(matchAny("docs/guide/intro.md", ["**/*.md"]));
});

test("literal filename without wildcard is anchored", () => {
  assert.ok(matchAny("Dockerfile", ["Dockerfile"]));
  assert.ok(!matchAny("sub/Dockerfile", ["Dockerfile"]));
});

test("globToRegex without brace expansion works for simple patterns", () => {
  assert.ok(globToRegex("server/**").test("server/routes/foo.ts"));
  assert.ok(globToRegex("client/**").test("client/components/App.tsx"));
});

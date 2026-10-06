import { test } from "node:test";
import assert from "node:assert/strict";

// We can't easily test Gmail without mocking googleapis, but we can test
// scopes() and token store key behavior by importing pure utilities.
import { scopes, DRIVE_READONLY, GMAIL_SEND } from "./auth.js";

test("scopes() joins scopes with spaces (Google format)", () => {
  assert.equal(scopes(DRIVE_READONLY, GMAIL_SEND), `${DRIVE_READONLY} ${GMAIL_SEND}`);
});

test("base64url round trip via Buffer (helper used in MIME builder)", () => {
  const encode = (s: string) =>
    Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const decode = (s: string) => {
    const padded = s.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(padded, "base64").toString("utf-8");
  };
  const cases = ["Hello, world", "تجربة عربي", "line1\nline2\r\n\t", "a"];
  for (const c of cases) {
    assert.equal(decode(encode(c)), c);
  }
});

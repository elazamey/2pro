import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NotionClient } from "./client.js";

describe("NotionClient", () => {
  it("throws without token", () => {
    assert.throws(() => new NotionClient({ token: "" as any }), /token/);
  });

  it("adds Bearer prefix and Notion-Version header on search", async () => {
    let capturedHeaders: any;
    const fetchMock: any = async (_url: string, init: any) => {
      capturedHeaders = init.headers;
      return { ok: true, text: async () => JSON.stringify({ results: [{ id: "db1", object: "database" }] }) } as any;
    };
    const c = new NotionClient({ token: "secret_xxx", fetch: fetchMock });
    const results = await c.searchDatabases();
    assert.equal(results.length, 1);
    assert.ok(capturedHeaders.Authorization.startsWith("Bearer "));
    assert.ok(capturedHeaders["Notion-Version"]);
  });
});

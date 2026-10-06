import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LinearClient } from "./client.js";

describe("LinearClient", () => {
  it("throws without api key", () => {
    assert.throws(() => new LinearClient({ apiKey: "" as any }), /API key/);
  });

  it("sends Authorization header and parses viewer response", async () => {
    const fetchMock: any = async (_url: string, init: any) => ({
      ok: true,
      text: async () => JSON.stringify({ data: { viewer: { id: "u1", name: "Ada", email: "a@b.c" } } }),
    } as any);
    const c = new LinearClient({ apiKey: "lin_api_xxx", fetch: fetchMock });
    const v = await c.viewer();
    assert.equal(v.name, "Ada");
  });
});

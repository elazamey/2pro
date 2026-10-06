import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { WebhookEngine } from "./engine.js";

describe("WebhookEngine", () => {
  it("detects GitHub event type and runs matching failure rule", async () => {
    const logs: string[] = [];
    const engine = new WebhookEngine({
      log: (_l, m) => logs.push(m),
      rules: [
        { id: "failures", name: "Failures", enabled: true, when: { sources: ["github"] }, action: "alert-on-failure" },
        { id: "log", name: "Log", enabled: true, when: {}, action: "log-event" },
      ],
    });
    const payload = JSON.stringify({ check_run: { conclusion: "failure", name: "build" }, repository: { full_name: "a/b" } });
    const { results } = await engine.ingest("github", payload, { "x-github-event": "check_run", "x-github-delivery": "d1" });
    assert.ok(results.some((r) => r.action === "alert-on-failure" && r.ok));
    assert.ok(logs.some((l) => l.includes("CI failure")));
  });

  it("rejects GitHub with invalid signature when secret is set", async () => {
    const engine = new WebhookEngine({
      secrets: { github: "shhh" },
      rules: [{ id: "log", name: "Log", enabled: true, when: {}, action: "log-event" }],
      log: () => {},
    });
    const payload = JSON.stringify({ hello: "world" });
    const { event, results } = await engine.ingest(
      "github",
      payload,
      { "x-github-event": "ping", "x-github-delivery": "d2", "x-hub-signature-256": "sha256=deadbeef" },
    );
    assert.equal(event.signatureValid, false);
    assert.equal(results.length, 0);
  });

  it("accepts GitHub with valid HMAC signature", async () => {
    const secret = "shhh";
    const engine = new WebhookEngine({
      secrets: { github: secret },
      rules: [{ id: "log", name: "Log", enabled: true, when: {}, action: "log-event" }],
      log: () => {},
    });
    const payload = JSON.stringify({ zen: "cool" });
    const sig = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const { event } = await engine.ingest("github", payload, { "x-github-event": "ping", "x-github-delivery": "d3", "x-hub-signature-256": sig });
    assert.equal(event.signatureValid, true);
    assert.equal(event.type, "ping");
  });
});

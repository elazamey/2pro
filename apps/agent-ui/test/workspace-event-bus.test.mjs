import assert from "node:assert/strict";
import test from "node:test";
import { parseSseFrame } from "../lib/agent-contract.mjs";
import { LearningContractValidationError } from "../lib/learning-contract.mjs";
import {
  WorkspaceCursorNotFoundError,
  WorkspaceEventBus,
  WorkspaceReplayGapError,
  WorkspaceSubscriberOverflowError,
  formatWorkspaceSseFrame,
} from "../lib/workspace-event-bus.mjs";

const timestamp = "2026-10-06T12:00:00.000Z";
const projectScope = { type: "project", id: "project-1" };

function createBus(options = {}) {
  let id = 0;
  return new WorkspaceEventBus({
    clock: () => timestamp,
    createId: () => `event-${++id}`,
    ...options,
  });
}

function forget(bus, scope = projectScope, memoryId = "memory-1") {
  return bus.publish({
    type: "memory.forgotten",
    scope,
    source: "user",
    approvalId: null,
    payload: {
      memoryId,
      scope,
      forgottenAt: timestamp,
      tombstoneId: `tombstone-${memoryId}`,
    },
  });
}

test("publishes validated immutable events with per-scope sequence and SSE framing", () => {
  const bus = createBus();
  const event = forget(bus);
  assert.equal(event.sequence, 1);
  assert.equal(event.source, "user");
  assert.equal(event.approvalId, null);
  assert.equal(Object.isFrozen(event), true);
  assert.equal("content" in event.payload, false);

  const frame = formatWorkspaceSseFrame(event);
  const parsed = parseSseFrame(frame.trimEnd());
  assert.equal(parsed.id, event.id);
  assert.equal(parsed.event, event.type);
  assert.equal(parsed.data.sequence, 1);

  const otherScopeEvent = forget(bus, { type: "user", id: "user-1" }, "memory-2");
  assert.equal(otherScopeEvent.sequence, 1);
  assert.equal(otherScopeEvent.scope.type, "user");
  bus.close();
});

test("replays only the requested scope and resumes from sequence or event ID", async () => {
  const bus = createBus();
  const first = forget(bus, projectScope, "memory-1");
  const second = forget(bus, projectScope, "memory-2");
  forget(bus, { type: "user", id: "user-1" }, "memory-other");

  const fromStart = bus.subscribe(projectScope, { afterSequence: 0 });
  assert.equal((await fromStart.next()).value.id, first.id);
  assert.equal((await fromStart.next()).value.id, second.id);
  await fromStart.return();

  const fromEventId = bus.subscribe(projectScope, { afterEventId: first.id });
  assert.equal((await fromEventId.next()).value.id, second.id);
  await fromEventId.return();
  assert.equal((await fromEventId.next()).done, true);

  const fromSequence = bus.subscribe(projectScope, { afterSequence: 1 });
  assert.equal((await fromSequence.next()).value.id, second.id);
  await fromSequence.return();
  bus.close();
});

test("rejects stale replay cursors and unknown event IDs instead of silently skipping events", async () => {
  const bus = createBus({ maxEventsPerScope: 2 });
  const first = forget(bus, projectScope, "memory-1");
  forget(bus, projectScope, "memory-2");
  const third = forget(bus, projectScope, "memory-3");

  assert.throws(() => bus.subscribe(projectScope, { afterSequence: 0 }), WorkspaceReplayGapError);
  assert.throws(() => bus.subscribe(projectScope, { afterEventId: first.id }), WorkspaceCursorNotFoundError);
  const replay = bus.subscribe(projectScope, { afterSequence: 1 });
  assert.equal((await replay.next()).value.sequence, 2);
  assert.equal((await replay.next()).value.id, third.id);
  await replay.return();
  assert.equal(third.sequence, 3);
  bus.close();
});

test("fails closed on invalid payloads and SSE-unsafe IDs without consuming a sequence", () => {
  const bus = createBus();
  const unsafeIdBus = createBus({ createId: () => "event-unsafe\nid: injected" });
  assert.throws(() => forget(unsafeIdBus), LearningContractValidationError);
  unsafeIdBus.close();
  assert.throws(() => bus.publish({
    type: "knowledge.relation.created",
    scope: projectScope,
    source: "agent",
    payload: {
      relation: {
        contractVersion: "1", id: "relation-1",
        subject: { kind: "project", id: "project-1" }, predicate: "uses",
        object: { kind: "technology", id: "Hono" }, scope: projectScope,
        lifecycle: "invalidated", confidence: 0.9,
        sourceRefs: [{ kind: "official_docs", sourceId: "source-1" }],
        createdAt: timestamp, updatedAt: timestamp, revision: 1,
      },
    },
  }), LearningContractValidationError);
  assert.equal(forget(bus).sequence, 1);
  bus.close();
});

test("bounds slow subscribers and supports abort and bus shutdown", async () => {
  const bus = createBus({ maxBufferedEvents: 1 });
  const first = forget(bus, projectScope, "memory-1");
  const subscription = bus.subscribe(projectScope, { afterSequence: 1 });
  forget(bus, projectScope, "memory-2");
  forget(bus, projectScope, "memory-3");
  assert.equal((await subscription.next()).value.sequence, 2);
  await assert.rejects(subscription.next(), WorkspaceSubscriberOverflowError);

  const controller = new AbortController();
  const aborted = bus.subscribe({ type: "user", id: "user-1" }, { signal: controller.signal });
  controller.abort();
  assert.equal((await aborted.next()).done, true);

  const live = bus.subscribe(projectScope, { afterSequence: 3 });
  bus.close();
  assert.equal((await live.next()).done, true);
  assert.equal(first.sequence, 1);
  assert.throws(() => bus.publish({}), /closed/);
});

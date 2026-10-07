import assert from "node:assert/strict";
import test from "node:test";
import {
  ContractValidationError,
  parseExecutionEvent,
  parseProject,
  parseSseFrame,
  parseTask,
} from "../lib/agent-contract.mjs";
import { LearningContractValidationError } from "../lib/learning-contract.mjs";

const timestamp = "2026-10-06T12:30:00.000Z";

function taskFixture(overrides = {}) {
  return {
    contractVersion: "1",
    id: "task-123",
    projectId: "project-123",
    title: "Prepare release",
    prompt: "Review the release checklist",
    status: "running",
    messages: [{ id: "message-1", role: "user", content: "Review the release checklist", createdAt: timestamp }],
    steps: [{ id: "inspect", title: "Inspect project", description: "Read the release files", status: "running" }],
    artifacts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function eventFixture(type, payload, overrides = {}) {
  return {
    contractVersion: "1",
    id: "event-1",
    taskId: "task-123",
    sequence: 1,
    occurredAt: timestamp,
    type,
    payload,
    ...overrides,
  };
}

test("parseTask normalizes a versioned task record", () => {
  const task = parseTask(taskFixture());
  assert.equal(task.id, "task-123");
  assert.equal(task.status, "running");
  assert.equal(task.projectId, "project-123");
  assert.equal(task.messages[0].role, "user");
  assert.equal(task.steps[0].status, "running");
});

test("parseTask rejects unknown statuses and non-versioned payloads", () => {
  assert.throws(() => parseTask(taskFixture({ status: "almost_done" })), ContractValidationError);
  assert.throws(() => parseTask(taskFixture({ contractVersion: "2" })), ContractValidationError);
});

test("parseProject normalizes project context", () => {
  const project = parseProject({
    contractVersion: "1",
    id: "project-123",
    name: "Release work",
    description: "Release prep",
    instructions: "Ask before deployment",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  assert.equal(project.name, "Release work");
  assert.equal(project.instructions, "Ask before deployment");
});

test("parseExecutionEvent validates and normalizes a tool progress event", () => {
  const event = parseExecutionEvent("tool.progress", eventFixture("tool.progress", {
    toolCallId: "browser-1",
    message: "Waiting for the page response",
    percent: 40,
  }));
  assert.equal(event.type, "tool.progress");
  assert.equal(event.sequence, 1);
  assert.equal(event.payload.percent, 40);
});

test("parseExecutionEvent supports the required event vocabulary", () => {
  const examples = [
    ["task.started", { status: "running" }],
    ["task.planning", { steps: [{ id: "inspect", title: "Inspect", description: "", status: "pending" }] }],
    ["tool.started", { toolCallId: "shell-1", toolName: "terminal" }],
    ["tool.progress", { toolCallId: "shell-1", percent: 50 }],
    ["tool.output", { toolCallId: "shell-1", summary: "Command finished" }],
    ["approval.required", { approvalId: "approval-1", action: "Write file", reason: "Creates a new artifact" }],
    ["artifact.created", { artifact: { id: "artifact-1", name: "report.md", kind: "document", createdAt: timestamp } }],
    ["task.completed", { summary: "Release review complete" }],
    ["task.failed", { error: { code: "TOOL_ERROR", message: "Tool unavailable", retryable: true } }],
  ];
  for (const [type, payload] of examples) {
    assert.equal(parseExecutionEvent(type, eventFixture(type, payload)).type, type);
  }
});

test("parseExecutionEvent validates task-scoped memory and lesson events for the UI consumer", () => {
  const memory = {
    contractVersion: "1", id: "memory-1", kind: "procedural", title: "Test before build",
    content: "Run tests before the production build.", scope: { type: "project", id: "project-123" },
    lifecycle: "verified", confidence: 0.95,
    sourceRefs: [{ kind: "task_experience", sourceId: "experience-1", taskId: "task-123" }],
    evidenceStats: { observations: 3, successes: 3, failures: 0, verificationCount: 1 }, revision: 2,
    createdAt: timestamp, updatedAt: timestamp, lastUsedAt: null, expiresAt: null,
  };
  const retrieved = parseExecutionEvent("memory.retrieved", eventFixture("memory.retrieved", {
    queryId: "query-1", memories: [memory], truncated: false,
  }));
  assert.equal(retrieved.payload.memories[0].lifecycle, "verified");

  const relations = parseExecutionEvent("knowledge.relations_retrieved", eventFixture("knowledge.relations_retrieved", {
    queryId: "graph-query-1",
    relations: [{
      contractVersion: "1", id: "relation-1", subject: { kind: "project", id: "project-123" },
      predicate: "uses", object: { kind: "technology", id: "Hono" },
      scope: { type: "project", id: "project-123" }, lifecycle: "verified", confidence: 0.9,
      sourceRefs: [{ kind: "official_docs", sourceId: "source-1", version: "4.2.1" }],
      createdAt: timestamp, updatedAt: timestamp, revision: 1,
    }],
    truncated: false,
  }));
  assert.equal(relations.payload.relations[0].predicate, "uses");

  const lesson = {
    contractVersion: "1", id: "lesson-1", kind: "strategy", title: "Test first",
    trigger: "When changing app code", recommendation: "Run tests before build.",
    scope: { type: "project", id: "project-123" }, lifecycle: "candidate", confidence: 0.8,
    evidence: [{ id: "evidence-1", taskId: "task-123", outcome: "success", strategy: "test-first", summary: "The test caught an error.", occurredAt: timestamp }],
    sourceRefs: [{ kind: "task_experience", sourceId: "experience-1", taskId: "task-123" }],
    createdAt: timestamp, updatedAt: timestamp, revision: 1,
  };
  const candidate = parseExecutionEvent("learning.lesson.candidate", eventFixture("learning.lesson.candidate", { lesson }));
  assert.equal(candidate.payload.lesson.lifecycle, "candidate");
  assert.throws(() => parseExecutionEvent("learning.lesson.candidate", eventFixture("learning.lesson.candidate", { lesson: { ...lesson, lifecycle: "verified" } })), LearningContractValidationError);
});

test("parseExecutionEvent ignores legacy events and rejects invalid sequence or version", () => {
  assert.equal(parseExecutionEvent("steps", { steps: [] }), null);
  assert.equal(parseExecutionEvent("message", "legacy reply"), null);
  assert.throws(() => parseExecutionEvent("message", eventFixture("task.started", {})), ContractValidationError);
  assert.throws(() => parseExecutionEvent("task.started", eventFixture("legacy.started", {})), ContractValidationError);
  assert.throws(() => parseExecutionEvent("task.started", eventFixture("task.started", {}, { sequence: 0 })), ContractValidationError);
  assert.throws(() => parseExecutionEvent("task.started", eventFixture("task.started", {}, { contractVersion: "2" })), ContractValidationError);
});

test("parseSseFrame reads event IDs and multi-line JSON data", () => {
  const parsed = parseSseFrame(`id: event-9\nevent: task.started\ndata: {"contractVersion":"1",\ndata: "id":"event-9"}`);
  assert.equal(parsed.id, "event-9");
  assert.equal(parsed.event, "task.started");
  assert.deepEqual(parsed.data, { contractVersion: "1", id: "event-9" });
});

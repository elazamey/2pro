import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LearningContractValidationError,
  LEARNING_TASK_EVENT_TYPES,
  WORKSPACE_EVENT_SOURCES,
  WORKSPACE_EVENT_TYPES,
  parseApprovalRecord,
  parseKnowledgeItem,
  parseKnowledgeRelation,
  parseKnowledgeSource,
  parseLearningEvaluation,
  parseLearningExperience,
  parseLearningExperiment,
  parseLessonRecord,
  parseMemoryRecord,
  parseSkillRecord,
  parseWorkspaceEvent,
} from "../lib/learning-contract.mjs";

const at = "2026-10-06T12:00:00.000Z";
const scope = { type: "project", id: "project-1" };
const taskSource = { kind: "task_experience", sourceId: "experience-1", taskId: "task-1" };

function memory(overrides = {}) {
  return {
    contractVersion: "1",
    id: "memory-1",
    kind: "procedural",
    title: "Test before build",
    content: "Run the project tests before building.",
    scope,
    lifecycle: "candidate",
    confidence: 0.7,
    sourceRefs: [taskSource],
    evidenceStats: { observations: 1, successes: 1, failures: 0, verificationCount: 0 },
    revision: 1,
    createdAt: at,
    updatedAt: at,
    lastUsedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

function source(overrides = {}) {
  return {
    contractVersion: "1",
    id: "source-1",
    kind: "url",
    title: "Agent API reference",
    canonicalUri: "https://docs.example.com/agent/v4",
    version: "4.2.1",
    status: "ready",
    scope,
    publishedAt: at,
    retrievedAt: at,
    lastSyncedAt: at,
    createdAt: at,
    updatedAt: at,
    revision: 1,
    ...overrides,
  };
}

function knowledgeItem(overrides = {}) {
  return {
    contractVersion: "1",
    id: "knowledge-1",
    sourceId: "source-1",
    sourceVersion: "4.2.1",
    kind: "api_endpoint",
    title: "Create task endpoint",
    statement: "POST /v1/tasks creates a task.",
    scope,
    lifecycle: "verified",
    confidence: 0.95,
    citations: [{ sourceId: "source-1", locator: "Tasks / Create", page: 12 }],
    validFrom: at,
    validUntil: null,
    createdAt: at,
    updatedAt: at,
    revision: 1,
    ...overrides,
  };
}

function relation(overrides = {}) {
  return {
    contractVersion: "1",
    id: "relation-1",
    subject: { kind: "project", id: "project-1" },
    predicate: "uses",
    object: { kind: "technology", id: "Hono" },
    scope,
    lifecycle: "verified",
    confidence: 0.92,
    sourceRefs: [{ kind: "official_docs", sourceId: "source-1", version: "4.2.1" }],
    createdAt: at,
    updatedAt: at,
    revision: 1,
    ...overrides,
  };
}

function lesson(overrides = {}) {
  return {
    contractVersion: "1",
    id: "lesson-1",
    kind: "strategy",
    title: "Run tests before build",
    trigger: "When changing application code",
    recommendation: "Run the relevant test suite before starting the production build.",
    scope,
    lifecycle: "candidate",
    confidence: 0.8,
    evidence: [{ id: "evidence-1", taskId: "task-1", outcome: "success", strategy: "test-first", summary: "Tests caught a type error before build.", occurredAt: at }],
    sourceRefs: [taskSource],
    createdAt: at,
    updatedAt: at,
    revision: 1,
    ...overrides,
  };
}

function experience(overrides = {}) {
  return {
    contractVersion: "1",
    id: "experience-1",
    taskId: "task-1",
    projectId: "project-1",
    outcome: "success",
    summary: "Tests passed and the application built successfully.",
    strategies: [{ name: "test-first", outcome: "success" }],
    sourceRefs: [taskSource],
    capturedAt: at,
    expiresAt: null,
    ...overrides,
  };
}

function evaluation(overrides = {}) {
  return {
    contractVersion: "1",
    id: "evaluation-1",
    taskId: "task-1",
    experienceId: "experience-1",
    outcome: "accepted",
    scores: { correctness: 95, completeness: 90, efficiency: 82, policyCompliance: 100, userSatisfaction: null },
    evaluatorVersion: "eval-v1",
    policyFindings: [],
    createdAt: at,
    ...overrides,
  };
}

function experiment(overrides = {}) {
  return {
    contractVersion: "1",
    id: "experiment-1",
    targetKind: "lesson",
    targetId: "lesson-1",
    status: "passed",
    sandbox: "synthetic",
    baselineRuns: 3,
    candidateRuns: 3,
    passedRuns: 3,
    failedRuns: 0,
    summary: "The candidate workflow passed all isolated cases.",
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function skill(overrides = {}) {
  return {
    contractVersion: "1",
    id: "skill-1",
    name: "Release verification",
    description: "Run a bounded release-readiness checklist.",
    version: "1.0.0",
    scope,
    lifecycle: "candidate",
    sourceRefs: [taskSource],
    testSummary: { passed: 3, total: 3 },
    successRate: 1,
    requiresApproval: true,
    createdAt: at,
    updatedAt: at,
    revision: 1,
    ...overrides,
  };
}

test("machine-readable learning schema is valid JSON and defines versioned records", async () => {
  const schema = JSON.parse(await readFile(new URL("../contracts/learning-memory-v1.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  for (const name of ["memoryRecord", "knowledgeSource", "knowledgeItem", "knowledgeRelation", "lessonRecord", "learningExperience", "learningEvaluation", "learningExperiment", "skillRecord", "approvalRecord", "taskLearningEvent", "workspaceEvent"]) {
    assert.ok(schema.$defs[name], `missing schema definition ${name}`);
  }
  assert.deepEqual(schema.$defs.taskLearningEvent.properties.type.enum, [...LEARNING_TASK_EVENT_TYPES]);
  assert.deepEqual(schema.$defs.workspaceEvent.properties.type.enum, [...WORKSPACE_EVENT_TYPES]);
  assert.deepEqual(schema.$defs.workspaceEvent.properties.source.enum, [...WORKSPACE_EVENT_SOURCES]);
  const safeIdPattern = new RegExp(schema.$defs.id.pattern);
  assert.equal(safeIdPattern.test("event-123"), true);
  assert.equal(safeIdPattern.test("event\nid"), false);
  assert.ok(schema.$defs.workspaceEvent.required.includes("source"));
  assert.ok(schema.$defs.workspaceEvent.required.includes("approvalId"));
});

test("memory parser normalizes a sourced, scoped record and rejects weak provenance", () => {
  const parsed = parseMemoryRecord(memory());
  assert.equal(parsed.scope.type, "project");
  assert.equal(parsed.confidence, 0.7);
  assert.throws(() => parseMemoryRecord(memory({ sourceRefs: [] })), LearningContractValidationError);
  assert.throws(() => parseMemoryRecord(memory({ confidence: 1.1 })), LearningContractValidationError);
  assert.throws(() => parseMemoryRecord(memory({ scope: { type: "organization", id: "" } })), LearningContractValidationError);
});

test("knowledge items preserve source version, citations and graph relations", () => {
  assert.equal(parseKnowledgeSource(source()).version, "4.2.1");
  assert.equal(parseKnowledgeRelation(relation()).object.id, "Hono");
  const parsed = parseKnowledgeItem(knowledgeItem());
  assert.equal(parsed.citations[0].locator, "Tasks / Create");
  assert.throws(() => parseKnowledgeItem(knowledgeItem({ citations: [] })), LearningContractValidationError);
  assert.throws(() => parseKnowledgeSource(source({ canonicalUri: "http://insecure.example" })), LearningContractValidationError);
});

test("experience, evaluation and lesson schemas validate bounded evidence", () => {
  assert.equal(parseLearningExperience(experience()).strategies[0].name, "test-first");
  assert.equal(parseLearningEvaluation(evaluation()).scores.userSatisfaction, null);
  assert.equal(parseLessonRecord(lesson()).evidence.length, 1);
  assert.throws(() => parseLessonRecord(lesson({ evidence: [] })), LearningContractValidationError);
  assert.throws(() => parseLessonRecord(lesson({ lifecycle: "active" })), LearningContractValidationError);
  assert.equal(parseLessonRecord(lesson({ lifecycle: "active", approvalId: "approval-1" })).lifecycle, "active");
  assert.throws(() => parseLearningEvaluation(evaluation({ scores: { correctness: 101, completeness: 90, efficiency: 80, policyCompliance: 100, userSatisfaction: null } })), LearningContractValidationError);
});

test("experiments are sandbox-only and active skills must have approval resolved", () => {
  assert.equal(parseLearningExperiment(experiment()).sandbox, "synthetic");
  assert.throws(() => parseLearningExperiment(experiment({ sandbox: "production" })), LearningContractValidationError);
  assert.throws(() => parseLearningExperiment(experiment({ candidateRuns: 0, passedRuns: 0 })), LearningContractValidationError);
  assert.equal(parseSkillRecord(skill()).requiresApproval, true);
  assert.throws(() => parseSkillRecord(skill({ lifecycle: "active", requiresApproval: true })), LearningContractValidationError);
  assert.throws(() => parseSkillRecord(skill({ lifecycle: "active", requiresApproval: false })), LearningContractValidationError);
  assert.equal(parseSkillRecord(skill({ lifecycle: "active", requiresApproval: false, approvalId: "approval-1" })).lifecycle, "active");
  assert.throws(() => parseSkillRecord(skill({ testSummary: { passed: 4, total: 3 } })), LearningContractValidationError);
});

test("approval records are versioned and resolved transitions need a timestamp", () => {
  const pending = parseApprovalRecord({
    contractVersion: "1", id: "approval-1", subjectKind: "skill", subjectId: "skill-1",
    requestedAction: "activate", requestedBy: "user-1", status: "pending", createdAt: at,
    resolvedAt: null, resolvedBy: null,
  });
  assert.equal(pending.status, "pending");
  assert.throws(() => parseApprovalRecord({ ...pending, status: "approved" }), LearningContractValidationError);
});

test("workspace approval metadata is bound to approval, lesson and skill records", () => {
  const common = { contractVersion: "1", id: "event-approval", sequence: 1, occurredAt: at, scope, source: "user" };
  const approvalEvent = {
    ...common, type: "approval.requested", approvalId: "approval-1",
    payload: { approval: {
      contractVersion: "1", id: "approval-1", subjectKind: "skill", subjectId: "skill-1",
      requestedAction: "activate", requestedBy: "user-1", status: "pending", createdAt: at,
      resolvedAt: null, resolvedBy: null,
    } },
  };
  assert.equal(parseWorkspaceEvent(approvalEvent.type, approvalEvent, approvalEvent.id).payload.approval.status, "pending");
  assert.throws(() => parseWorkspaceEvent(approvalEvent.type, { ...approvalEvent, approvalId: "approval-2" }, approvalEvent.id), LearningContractValidationError);
  const approvedLessonEvent = {
    ...common, type: "learning.lesson.status_changed", approvalId: "approval-1",
    payload: { lesson: lesson({ lifecycle: "approved", approvalId: "approval-1" }) },
  };
  assert.equal(parseWorkspaceEvent(approvedLessonEvent.type, approvedLessonEvent, approvedLessonEvent.id).payload.lesson.lifecycle, "approved");
  assert.throws(() => parseWorkspaceEvent(approvedLessonEvent.type, { ...approvedLessonEvent, approvalId: null }, approvedLessonEvent.id), LearningContractValidationError);

  const activeSkillEvent = {
    ...common, id: "event-skill", type: "skill.status_changed", approvalId: "approval-1",
    payload: { skill: skill({ lifecycle: "active", requiresApproval: false, approvalId: "approval-1" }) },
  };
  assert.equal(parseWorkspaceEvent(activeSkillEvent.type, activeSkillEvent, activeSkillEvent.id).payload.skill.lifecycle, "active");
  assert.throws(() => parseWorkspaceEvent(activeSkillEvent.type, { ...activeSkillEvent, approvalId: null }, activeSkillEvent.id), LearningContractValidationError);
});

test("workspace relation events must match the resulting lifecycle", () => {
  const event = {
    contractVersion: "1", id: "event-2", sequence: 2, occurredAt: at, scope,
    type: "knowledge.relation.created", source: "agent", approvalId: null, payload: { relation: relation() },
  };
  assert.equal(parseWorkspaceEvent(event.type, event, event.id).payload.relation.predicate, "uses");
  const invalid = { ...event, payload: { relation: relation({ lifecycle: "invalidated" }) } };
  assert.throws(() => parseWorkspaceEvent(invalid.type, invalid, invalid.id), LearningContractValidationError);
  const crossScope = { ...event, scope: { type: "user", id: "user-1" } };
  assert.throws(() => parseWorkspaceEvent(crossScope.type, crossScope, crossScope.id), LearningContractValidationError);
});

test("workspace event parser enforces SSE id and emits content-free forget tombstones", () => {
  const event = {
    contractVersion: "1", id: "event-1", sequence: 1, occurredAt: at, scope,
    type: "memory.forgotten", source: "user", approvalId: null,
    payload: { memoryId: "memory-1", scope, forgottenAt: at, tombstoneId: "tombstone-1" },
  };
  const parsed = parseWorkspaceEvent("memory.forgotten", event, "event-1");
  assert.equal(parsed.payload.memoryId, "memory-1");
  assert.equal(parsed.source, "user");
  assert.equal(parsed.approvalId, null);
  assert.equal("content" in parsed.payload, false);
  assert.throws(() => parseWorkspaceEvent("memory.forgotten", event, "wrong-event-id"), LearningContractValidationError);
  assert.equal(parseWorkspaceEvent("future.unrecognized", { type: "future.unrecognized" }, "x"), null);
});

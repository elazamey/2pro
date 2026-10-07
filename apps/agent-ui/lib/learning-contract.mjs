const CONTRACT_VERSION = "1";
const MAX_ID = 160;
const MAX_TEXT = 8_000;
const MAX_ITEMS = 100;

export const LEARNING_TASK_EVENT_TYPES = Object.freeze([
  "memory.retrieved",
  "knowledge.retrieved",
  "knowledge.relations_retrieved",
  "knowledge.source.consulted",
  "learning.experience.recorded",
  "learning.evaluation.completed",
  "learning.lesson.candidate",
  "learning.lesson.status_changed",
  "learning.experiment.completed",
  "skill.candidate",
  "skill.status_changed",
]);

export const WORKSPACE_EVENT_SOURCES = Object.freeze(["agent", "user", "system", "connector", "scheduler", "service"]);

export const WORKSPACE_EVENT_TYPES = Object.freeze([
  "memory.created",
  "memory.updated",
  "memory.lifecycle_changed",
  "memory.forgotten",
  "knowledge.source.ingested",
  "knowledge.source.stale",
  "knowledge.source.superseded",
  "knowledge.item.extracted",
  "knowledge.item.superseded",
  "knowledge.relation.created",
  "knowledge.relation.invalidated",
  "knowledge.retrieved",
  "learning.experience.recorded",
  "learning.evaluation.completed",
  "learning.lesson.candidate",
  "learning.lesson.status_changed",
  "learning.experiment.completed",
  "skill.candidate",
  "skill.status_changed",
  "skill.version.created",
  "skill.rolled_back",
  "approval.requested",
  "approval.resolved",
]);

const MEMORY_KINDS = new Set(["episodic", "semantic", "procedural", "preference"]);
const MEMORY_LIFECYCLES = new Set(["candidate", "observed", "learned", "verified", "trusted", "stale", "archived"]);
const SCOPE_TYPES = new Set(["task", "project", "user", "organization"]);
const SOURCE_KINDS = new Set(["user", "document", "official_docs", "task_experience", "tool_output", "generated", "inferred"]);
const KNOWLEDGE_SOURCE_KINDS = new Set(["document", "url", "repository", "api"]);
const KNOWLEDGE_SOURCE_STATUSES = new Set(["queued", "indexing", "ready", "failed", "stale", "superseded", "archived"]);
const KNOWLEDGE_KINDS = new Set(["fact", "rule", "procedure", "example", "api_endpoint", "parameter", "schema", "constraint", "warning", "dependency", "architecture", "best_practice"]);
const KNOWLEDGE_ENTITY_KINDS = new Set(["project", "source", "item", "skill", "technology", "api", "dependency"]);
const KNOWLEDGE_RELATION_PREDICATES = new Set(["uses", "depends_on", "deployed_to", "implements", "derived_from", "supersedes", "contradicts", "contains", "related_to"]);
const KNOWLEDGE_RELATION_LIFECYCLES = new Set(["candidate", "verified", "stale", "invalidated"]);
const KNOWLEDGE_LIFECYCLES = new Set(["candidate", "verified", "stale", "superseded", "archived"]);
const LESSON_KINDS = new Set(["fact", "procedure", "preference", "failure", "success", "strategy"]);
const LESSON_LIFECYCLES = new Set(["candidate", "testing", "verified", "approved", "active", "stale", "rejected", "archived"]);
const SKILL_LIFECYCLES = new Set(["candidate", "review", "active", "deprecated", "rejected", "archived"]);
const EXPERIENCE_OUTCOMES = new Set(["success", "partial", "failure", "cancelled"]);
const STRATEGY_OUTCOMES = new Set(["success", "partial", "failure", "skipped"]);
const EXPERIMENT_STATUSES = new Set(["proposed", "queued", "running", "passed", "failed", "cancelled"]);
const APPROVAL_STATUSES = new Set(["pending", "approved", "rejected", "expired", "cancelled"]);
const WORKSPACE_EVENT_SOURCE_SET = new Set(WORKSPACE_EVENT_SOURCES);

export class LearningContractValidationError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "LearningContractValidationError";
    this.path = path;
  }
}

function fail(path, message) {
  throw new LearningContractValidationError(path, message);
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
  return value;
}

function text(value, path, max = MAX_TEXT, { allowEmpty = false } = {}) {
  if (typeof value !== "string") fail(path, "expected a string");
  const normalized = value.trim();
  if (!allowEmpty && !normalized) fail(path, "must not be empty");
  if (normalized.length > max) fail(path, `must be at most ${max} characters`);
  return normalized;
}

function enumValue(value, path, allowed) {
  const normalized = text(value, path, 40);
  if (!allowed.has(normalized)) fail(path, "unsupported value");
  return normalized;
}

function timestamp(value, path, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(path, "expected an ISO-8601 timestamp with timezone");
  }
  return new Date(value).toISOString();
}

function identifier(value, path) {
  const normalized = text(value, path, MAX_ID);
  if (/[\u0000-\u001f\u007f]/.test(normalized)) fail(path, "control characters are not allowed in IDs");
  return normalized;
}

function safeCount(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) fail(path, "expected a non-negative safe integer");
  return value;
}

function score(value, path) {
  if (!Number.isFinite(value) || value < 0 || value > 100) fail(path, "expected a score from 0 to 100");
  return value;
}

function confidence(value, path) {
  if (!Number.isFinite(value) || value < 0 || value > 1) fail(path, "expected a confidence from 0 to 1");
  return value;
}

function list(value, path, max = MAX_ITEMS, normalize = (item) => item, { min = 0 } = {}) {
  if (!Array.isArray(value)) fail(path, "expected an array");
  if (value.length < min || value.length > max) fail(path, `expected between ${min} and ${max} items`);
  return value.map((item, index) => normalize(item, `${path}[${index}]`));
}

function versionedRecord(value, path) {
  const item = object(value, path);
  if (item.contractVersion !== CONTRACT_VERSION) fail(`${path}.contractVersion`, `expected version ${CONTRACT_VERSION}`);
  return item;
}

export function parseMemoryScope(value, path = "scope") {
  const item = object(value, path);
  return {
    type: enumValue(item.type, `${path}.type`, SCOPE_TYPES),
    id: identifier(item.id, `${path}.id`),
  };
}

export function parseSourceReference(value, path = "sourceRef") {
  const item = object(value, path);
  const result = { kind: enumValue(item.kind, `${path}.kind`, SOURCE_KINDS) };
  if (item.sourceId !== undefined) result.sourceId = identifier(item.sourceId, `${path}.sourceId`);
  if (item.taskId !== undefined) result.taskId = identifier(item.taskId, `${path}.taskId`);
  if (item.version !== undefined && item.version !== null) result.version = text(item.version, `${path}.version`, 120);
  if (item.locator !== undefined) result.locator = text(item.locator, `${path}.locator`, 500);
  if (item.uri !== undefined) {
    const uri = text(item.uri, `${path}.uri`, 2_000);
    if (!/^https:\/\//i.test(uri)) fail(`${path}.uri`, "only HTTPS source URIs are allowed");
    result.uri = uri;
  }
  if (!result.sourceId && !result.taskId && !result.uri) fail(path, "requires sourceId, taskId, or HTTPS uri");
  return result;
}

function parseEvidenceStats(value, path) {
  const item = object(value, path);
  return {
    observations: safeCount(item.observations, `${path}.observations`),
    successes: safeCount(item.successes, `${path}.successes`),
    failures: safeCount(item.failures, `${path}.failures`),
    verificationCount: safeCount(item.verificationCount, `${path}.verificationCount`),
  };
}

export function parseMemoryRecord(value, path = "memory") {
  const item = versionedRecord(value, path);
  const sourceRefs = list(item.sourceRefs, `${path}.sourceRefs`, 20, parseSourceReference, { min: 1 });
  const lifecycle = enumValue(item.lifecycle, `${path}.lifecycle`, MEMORY_LIFECYCLES);
  if (["verified", "trusted"].includes(lifecycle) && !sourceRefs.length) fail(`${path}.sourceRefs`, "verified memories require provenance");
  return {
    contractVersion: CONTRACT_VERSION,
    id: identifier(item.id, `${path}.id`),
    kind: enumValue(item.kind, `${path}.kind`, MEMORY_KINDS),
    title: text(item.title, `${path}.title`, 160),
    content: text(item.content, `${path}.content`, MAX_TEXT),
    scope: parseMemoryScope(item.scope, `${path}.scope`),
    lifecycle,
    confidence: confidence(item.confidence, `${path}.confidence`),
    sourceRefs,
    evidenceStats: parseEvidenceStats(item.evidenceStats, `${path}.evidenceStats`),
    revision: safeCount(item.revision, `${path}.revision`) || fail(`${path}.revision`, "expected a positive integer"),
    createdAt: timestamp(item.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(item.updatedAt, `${path}.updatedAt`),
    lastUsedAt: timestamp(item.lastUsedAt, `${path}.lastUsedAt`, { nullable: true }),
    expiresAt: timestamp(item.expiresAt, `${path}.expiresAt`, { nullable: true }),
  };
}

export function parseKnowledgeSource(value, path = "knowledgeSource") {
  const item = versionedRecord(value, path);
  if (item.canonicalUri === undefined) fail(`${path}.canonicalUri`, "expected a value or null");
  const canonicalUri = item.canonicalUri === null ? null : text(item.canonicalUri, `${path}.canonicalUri`, 2_000);
  if (canonicalUri && !/^https:\/\//i.test(canonicalUri)) fail(`${path}.canonicalUri`, "only HTTPS source URIs are allowed");
  if (item.version === undefined) fail(`${path}.version`, "expected a value or null");
  return {
    contractVersion: CONTRACT_VERSION,
    id: identifier(item.id, `${path}.id`),
    kind: enumValue(item.kind, `${path}.kind`, KNOWLEDGE_SOURCE_KINDS),
    title: text(item.title, `${path}.title`, 240),
    canonicalUri,
    version: item.version === null ? null : text(item.version, `${path}.version`, 120),
    status: enumValue(item.status, `${path}.status`, KNOWLEDGE_SOURCE_STATUSES),
    scope: parseMemoryScope(item.scope, `${path}.scope`),
    publishedAt: timestamp(item.publishedAt, `${path}.publishedAt`, { nullable: true }),
    retrievedAt: timestamp(item.retrievedAt, `${path}.retrievedAt`),
    lastSyncedAt: timestamp(item.lastSyncedAt, `${path}.lastSyncedAt`, { nullable: true }),
    createdAt: timestamp(item.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(item.updatedAt, `${path}.updatedAt`),
    revision: safeCount(item.revision, `${path}.revision`) || fail(`${path}.revision`, "expected a positive integer"),
  };
}

function parseCitation(value, path) {
  const item = object(value, path);
  const result = {
    sourceId: identifier(item.sourceId, `${path}.sourceId`),
    locator: text(item.locator, `${path}.locator`, 500),
  };
  if (item.quote !== undefined) result.quote = text(item.quote, `${path}.quote`, 500);
  if (item.page !== undefined) result.page = safeCount(item.page, `${path}.page`);
  return result;
}

export function parseKnowledgeItem(value, path = "knowledgeItem") {
  const item = versionedRecord(value, path);
  if (item.sourceVersion === undefined) fail(`${path}.sourceVersion`, "expected a value or null");
  return {
    contractVersion: CONTRACT_VERSION,
    id: identifier(item.id, `${path}.id`),
    sourceId: identifier(item.sourceId, `${path}.sourceId`),
    sourceVersion: item.sourceVersion === null ? null : text(item.sourceVersion, `${path}.sourceVersion`, 120),
    kind: enumValue(item.kind, `${path}.kind`, KNOWLEDGE_KINDS),
    title: text(item.title, `${path}.title`, 240),
    statement: text(item.statement, `${path}.statement`, 4_000),
    scope: parseMemoryScope(item.scope, `${path}.scope`),
    lifecycle: enumValue(item.lifecycle, `${path}.lifecycle`, KNOWLEDGE_LIFECYCLES),
    confidence: confidence(item.confidence, `${path}.confidence`),
    citations: list(item.citations, `${path}.citations`, 20, parseCitation, { min: 1 }),
    validFrom: timestamp(item.validFrom, `${path}.validFrom`),
    validUntil: timestamp(item.validUntil, `${path}.validUntil`, { nullable: true }),
    createdAt: timestamp(item.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(item.updatedAt, `${path}.updatedAt`),
    revision: safeCount(item.revision, `${path}.revision`) || fail(`${path}.revision`, "expected a positive integer"),
  };
}

function parseKnowledgeEntityReference(value, path) {
  const item = object(value, path);
  return {
    kind: enumValue(item.kind, `${path}.kind`, KNOWLEDGE_ENTITY_KINDS),
    id: identifier(item.id, `${path}.id`),
  };
}

export function parseKnowledgeRelation(value, path = "knowledgeRelation") {
  const item = versionedRecord(value, path);
  return {
    contractVersion: CONTRACT_VERSION,
    id: identifier(item.id, `${path}.id`),
    subject: parseKnowledgeEntityReference(item.subject, `${path}.subject`),
    predicate: enumValue(item.predicate, `${path}.predicate`, KNOWLEDGE_RELATION_PREDICATES),
    object: parseKnowledgeEntityReference(item.object, `${path}.object`),
    scope: parseMemoryScope(item.scope, `${path}.scope`),
    lifecycle: enumValue(item.lifecycle, `${path}.lifecycle`, KNOWLEDGE_RELATION_LIFECYCLES),
    confidence: confidence(item.confidence, `${path}.confidence`),
    sourceRefs: list(item.sourceRefs, `${path}.sourceRefs`, 20, parseSourceReference, { min: 1 }),
    createdAt: timestamp(item.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(item.updatedAt, `${path}.updatedAt`),
    revision: safeCount(item.revision, `${path}.revision`) || fail(`${path}.revision`, "expected a positive integer"),
  };
}

function parseLessonEvidence(value, path) {
  const item = object(value, path);
  return {
    id: identifier(item.id, `${path}.id`),
    taskId: identifier(item.taskId, `${path}.taskId`),
    outcome: enumValue(item.outcome, `${path}.outcome`, new Set(["success", "partial", "failure"])),
    strategy: text(item.strategy, `${path}.strategy`, 240),
    summary: text(item.summary, `${path}.summary`, 600),
    occurredAt: timestamp(item.occurredAt, `${path}.occurredAt`),
  };
}

export function parseLessonRecord(value, path = "lesson") {
  const item = versionedRecord(value, path);
  const lesson = {
    contractVersion: CONTRACT_VERSION,
    id: identifier(item.id, `${path}.id`),
    kind: enumValue(item.kind, `${path}.kind`, LESSON_KINDS),
    title: text(item.title, `${path}.title`, 160),
    trigger: text(item.trigger, `${path}.trigger`, 500),
    recommendation: text(item.recommendation, `${path}.recommendation`, 2_000),
    scope: parseMemoryScope(item.scope, `${path}.scope`),
    lifecycle: enumValue(item.lifecycle, `${path}.lifecycle`, LESSON_LIFECYCLES),
    confidence: confidence(item.confidence, `${path}.confidence`),
    evidence: list(item.evidence, `${path}.evidence`, 50, parseLessonEvidence, { min: 1 }),
    sourceRefs: list(item.sourceRefs, `${path}.sourceRefs`, 20, parseSourceReference, { min: 1 }),
    createdAt: timestamp(item.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(item.updatedAt, `${path}.updatedAt`),
    revision: safeCount(item.revision, `${path}.revision`) || fail(`${path}.revision`, "expected a positive integer"),
  };
  if (item.experimentId !== undefined && item.experimentId !== null) lesson.experimentId = identifier(item.experimentId, `${path}.experimentId`);
  if (item.approvalId !== undefined && item.approvalId !== null) lesson.approvalId = identifier(item.approvalId, `${path}.approvalId`);
  if (["approved", "active"].includes(lesson.lifecycle) && !lesson.approvalId) fail(`${path}.approvalId`, "approved or active lessons require an approval reference");
  return lesson;
}

function parseStrategy(value, path) {
  const item = object(value, path);
  const strategy = {
    name: text(item.name, `${path}.name`, 240),
    outcome: enumValue(item.outcome, `${path}.outcome`, STRATEGY_OUTCOMES),
  };
  if (item.reason !== undefined) strategy.reason = text(item.reason, `${path}.reason`, 500);
  return strategy;
}

export function parseLearningExperience(value, path = "experience") {
  const item = versionedRecord(value, path);
  if (item.projectId === undefined) fail(`${path}.projectId`, "expected a value or null");
  return {
    contractVersion: CONTRACT_VERSION,
    id: identifier(item.id, `${path}.id`),
    taskId: identifier(item.taskId, `${path}.taskId`),
    projectId: item.projectId === null ? null : identifier(item.projectId, `${path}.projectId`),
    outcome: enumValue(item.outcome, `${path}.outcome`, EXPERIENCE_OUTCOMES),
    summary: text(item.summary, `${path}.summary`, 1_200),
    strategies: list(item.strategies, `${path}.strategies`, 30, parseStrategy),
    sourceRefs: list(item.sourceRefs, `${path}.sourceRefs`, 20, parseSourceReference, { min: 1 }),
    capturedAt: timestamp(item.capturedAt, `${path}.capturedAt`),
    expiresAt: timestamp(item.expiresAt, `${path}.expiresAt`, { nullable: true }),
  };
}

function parseUserFeedback(value, path) {
  const item = object(value, path);
  const feedback = {
    usefulness: enumValue(item.usefulness, `${path}.usefulness`, new Set(["useful", "not_useful"])),
    createdAt: timestamp(item.createdAt, `${path}.createdAt`),
  };
  if (item.note !== undefined) feedback.note = text(item.note, `${path}.note`, 500);
  return feedback;
}

export function parseLearningEvaluation(value, path = "evaluation") {
  const item = versionedRecord(value, path);
  const scores = object(item.scores, `${path}.scores`);
  if (scores.userSatisfaction === undefined) fail(`${path}.scores.userSatisfaction`, "expected a score or null");
  const normalizedScores = {
    correctness: score(scores.correctness, `${path}.scores.correctness`),
    completeness: score(scores.completeness, `${path}.scores.completeness`),
    efficiency: score(scores.efficiency, `${path}.scores.efficiency`),
    policyCompliance: score(scores.policyCompliance, `${path}.scores.policyCompliance`),
    userSatisfaction: scores.userSatisfaction === null ? null : score(scores.userSatisfaction, `${path}.scores.userSatisfaction`),
  };
  const result = {
    contractVersion: CONTRACT_VERSION,
    id: identifier(item.id, `${path}.id`),
    taskId: identifier(item.taskId, `${path}.taskId`),
    experienceId: identifier(item.experienceId, `${path}.experienceId`),
    outcome: enumValue(item.outcome, `${path}.outcome`, new Set(["accepted", "needs_review", "rejected"])),
    scores: normalizedScores,
    evaluatorVersion: text(item.evaluatorVersion, `${path}.evaluatorVersion`, 80),
    policyFindings: list(item.policyFindings, `${path}.policyFindings`, 30, (finding, findingPath) => text(finding, findingPath, 300)),
    createdAt: timestamp(item.createdAt, `${path}.createdAt`),
  };
  if (item.userFeedback !== undefined && item.userFeedback !== null) result.userFeedback = parseUserFeedback(item.userFeedback, `${path}.userFeedback`);
  return result;
}

export function parseLearningExperiment(value, path = "experiment") {
  const item = versionedRecord(value, path);
  const status = enumValue(item.status, `${path}.status`, EXPERIMENT_STATUSES);
  const sandbox = enumValue(item.sandbox, `${path}.sandbox`, new Set(["synthetic", "isolated"]));
  const result = {
    contractVersion: CONTRACT_VERSION,
    id: identifier(item.id, `${path}.id`),
    targetKind: enumValue(item.targetKind, `${path}.targetKind`, new Set(["lesson", "skill"])),
    targetId: identifier(item.targetId, `${path}.targetId`),
    status,
    sandbox,
    baselineRuns: safeCount(item.baselineRuns, `${path}.baselineRuns`),
    candidateRuns: safeCount(item.candidateRuns, `${path}.candidateRuns`),
    passedRuns: safeCount(item.passedRuns, `${path}.passedRuns`),
    failedRuns: safeCount(item.failedRuns, `${path}.failedRuns`),
    summary: text(item.summary, `${path}.summary`, 1_000),
    createdAt: timestamp(item.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(item.updatedAt, `${path}.updatedAt`),
  };
  if (status === "passed" && (result.candidateRuns === 0 || result.passedRuns === 0)) fail(`${path}.passedRuns`, "a passed experiment needs at least one passing candidate run");
  return result;
}

function parseSkillTestSummary(value, path) {
  const item = object(value, path);
  const passed = safeCount(item.passed, `${path}.passed`);
  const total = safeCount(item.total, `${path}.total`);
  if (passed > total) fail(path, "passed cannot exceed total");
  return { passed, total };
}

export function parseSkillRecord(value, path = "skill") {
  const item = versionedRecord(value, path);
  if (typeof item.requiresApproval !== "boolean") fail(`${path}.requiresApproval`, "expected a boolean");
  if (item.successRate === undefined) fail(`${path}.successRate`, "expected a score or null");
  const lifecycle = enumValue(item.lifecycle, `${path}.lifecycle`, SKILL_LIFECYCLES);
  if (["candidate", "review"].includes(lifecycle) && !item.requiresApproval) fail(`${path}.requiresApproval`, "candidate skills require explicit approval before activation");
  const result = {
    contractVersion: CONTRACT_VERSION,
    id: identifier(item.id, `${path}.id`),
    name: text(item.name, `${path}.name`, 160),
    description: text(item.description, `${path}.description`, 1_000),
    version: text(item.version, `${path}.version`, 40),
    scope: parseMemoryScope(item.scope, `${path}.scope`),
    lifecycle,
    sourceRefs: list(item.sourceRefs, `${path}.sourceRefs`, 20, parseSourceReference, { min: 1 }),
    testSummary: parseSkillTestSummary(item.testSummary, `${path}.testSummary`),
    successRate: item.successRate === null ? null : confidence(item.successRate, `${path}.successRate`),
    requiresApproval: item.requiresApproval,
    createdAt: timestamp(item.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(item.updatedAt, `${path}.updatedAt`),
    revision: safeCount(item.revision, `${path}.revision`) || fail(`${path}.revision`, "expected a positive integer"),
  };
  if (item.approvalId !== undefined && item.approvalId !== null) result.approvalId = identifier(item.approvalId, `${path}.approvalId`);
  if (lifecycle === "active" && item.requiresApproval) fail(`${path}.requiresApproval`, "an active skill cannot still require approval");
  if (lifecycle === "active" && !result.approvalId) fail(`${path}.approvalId`, "active skills require an approval reference");
  return result;
}

export function parseApprovalRecord(value, path = "approval") {
  const item = versionedRecord(value, path);
  if (item.resolvedBy === undefined) fail(`${path}.resolvedBy`, "expected an ID or null");
  const result = {
    contractVersion: CONTRACT_VERSION,
    id: identifier(item.id, `${path}.id`),
    subjectKind: enumValue(item.subjectKind, `${path}.subjectKind`, new Set(["memory", "lesson", "skill", "knowledge"])),
    subjectId: identifier(item.subjectId, `${path}.subjectId`),
    requestedAction: enumValue(item.requestedAction, `${path}.requestedAction`, new Set(["promote", "activate", "share_scope", "replace_version"])),
    requestedBy: identifier(item.requestedBy, `${path}.requestedBy`),
    status: enumValue(item.status, `${path}.status`, APPROVAL_STATUSES),
    createdAt: timestamp(item.createdAt, `${path}.createdAt`),
    resolvedAt: timestamp(item.resolvedAt, `${path}.resolvedAt`, { nullable: true }),
    resolvedBy: item.resolvedBy === null ? null : identifier(item.resolvedBy, `${path}.resolvedBy`),
  };
  if (result.status !== "pending" && result.resolvedAt === null) fail(`${path}.resolvedAt`, "resolved approvals require resolvedAt");
  if (item.reason !== undefined) result.reason = text(item.reason, `${path}.reason`, 500);
  return result;
}

function queryResult(value, path, key, parser) {
  const item = object(value, path);
  if (typeof item.truncated !== "boolean") fail(`${path}.truncated`, "expected a boolean");
  const result = {
    queryId: identifier(item.queryId, `${path}.queryId`),
    [key]: list(item[key], `${path}.${key}`, 30, parser),
    truncated: item.truncated === true,
  };
  return result;
}

export function parseLearningTaskEventPayload(type, value) {
  const payload = object(value, "event.payload");
  if (type === "memory.retrieved") {
    const result = queryResult(payload, "event.payload", "memories", parseMemoryRecord);
    if (result.memories.some((memory) => !["verified", "trusted"].includes(memory.lifecycle))) {
      fail("event.payload.memories", "default retrieval may contain only verified or trusted memories");
    }
    return result;
  }
  if (type === "knowledge.retrieved") {
    const result = queryResult(payload, "event.payload", "items", parseKnowledgeItem);
    if (result.items.some((item) => item.lifecycle !== "verified")) fail("event.payload.items", "default retrieval may contain only verified knowledge items");
    return result;
  }
  if (type === "knowledge.relations_retrieved") {
    const result = queryResult(payload, "event.payload", "relations", parseKnowledgeRelation);
    if (result.relations.some((relation) => relation.lifecycle !== "verified")) fail("event.payload.relations", "default retrieval may contain only verified relations");
    return result;
  }
  if (type === "knowledge.source.consulted") return { source: parseKnowledgeSource(payload.source, "event.payload.source") };
  if (type === "learning.experience.recorded") return { experience: parseLearningExperience(payload.experience, "event.payload.experience") };
  if (type === "learning.evaluation.completed") return { evaluation: parseLearningEvaluation(payload.evaluation, "event.payload.evaluation") };
  if (type === "learning.lesson.candidate" || type === "learning.lesson.status_changed") {
    const lesson = parseLessonRecord(payload.lesson, "event.payload.lesson");
    if (type === "learning.lesson.candidate" && lesson.lifecycle !== "candidate") fail("event.payload.lesson.lifecycle", "candidate event must carry candidate lifecycle");
    return { lesson };
  }
  if (type === "learning.experiment.completed") return { experiment: parseLearningExperiment(payload.experiment, "event.payload.experiment") };
  if (type === "skill.candidate" || type === "skill.status_changed") {
    const skill = parseSkillRecord(payload.skill, "event.payload.skill");
    if (type === "skill.candidate" && skill.lifecycle !== "candidate") fail("event.payload.skill.lifecycle", "candidate event must carry candidate lifecycle");
    return { skill };
  }
  return null;
}

function scopesMatch(left, right) {
  return left.type === right.type && left.id === right.id;
}

function requireEventScopeMatch(eventScope, recordScope, path) {
  if (!scopesMatch(eventScope, recordScope)) fail(path, "record scope must match the workspace event scope");
}

function normalizeWorkspacePayload(type, value) {
  const payload = object(value, "workspaceEvent.payload");
  if (["memory.created", "memory.updated", "memory.lifecycle_changed"].includes(type)) {
    return { memory: parseMemoryRecord(payload.memory, "workspaceEvent.payload.memory") };
  }
  if (type === "memory.forgotten") {
    return {
      memoryId: identifier(payload.memoryId, "workspaceEvent.payload.memoryId"),
      scope: parseMemoryScope(payload.scope, "workspaceEvent.payload.scope"),
      forgottenAt: timestamp(payload.forgottenAt, "workspaceEvent.payload.forgottenAt"),
      tombstoneId: identifier(payload.tombstoneId, "workspaceEvent.payload.tombstoneId"),
    };
  }
  if (["knowledge.source.ingested", "knowledge.source.stale", "knowledge.source.superseded"].includes(type)) {
    const source = parseKnowledgeSource(payload.source, "workspaceEvent.payload.source");
    if (type === "knowledge.source.stale" && source.status !== "stale") fail("workspaceEvent.payload.source.status", "stale event must carry stale source status");
    if (type === "knowledge.source.superseded" && source.status !== "superseded") fail("workspaceEvent.payload.source.status", "superseded event must carry superseded source status");
    return { source };
  }
  if (["knowledge.item.extracted", "knowledge.item.superseded"].includes(type)) {
    const item = parseKnowledgeItem(payload.item, "workspaceEvent.payload.item");
    if (type === "knowledge.item.superseded" && item.lifecycle !== "superseded") fail("workspaceEvent.payload.item.lifecycle", "superseded event must carry superseded item lifecycle");
    return { item };
  }
  if (["knowledge.relation.created", "knowledge.relation.invalidated"].includes(type)) {
    const relation = parseKnowledgeRelation(payload.relation, "workspaceEvent.payload.relation");
    if (type === "knowledge.relation.invalidated" && relation.lifecycle !== "invalidated") fail("workspaceEvent.payload.relation.lifecycle", "invalidation event must carry invalidated lifecycle");
    if (type === "knowledge.relation.created" && relation.lifecycle === "invalidated") fail("workspaceEvent.payload.relation.lifecycle", "creation event cannot carry invalidated lifecycle");
    return { relation };
  }
  if (type === "knowledge.retrieved") {
    const result = queryResult(payload, "workspaceEvent.payload", "items", parseKnowledgeItem);
    if (result.items.some((item) => item.lifecycle !== "verified")) fail("workspaceEvent.payload.items", "default retrieval may contain only verified knowledge items");
    return result;
  }
  if (type === "learning.experience.recorded") return { experience: parseLearningExperience(payload.experience, "workspaceEvent.payload.experience") };
  if (type === "learning.evaluation.completed") return { evaluation: parseLearningEvaluation(payload.evaluation, "workspaceEvent.payload.evaluation") };
  if (["learning.lesson.candidate", "learning.lesson.status_changed"].includes(type)) {
    const lesson = parseLessonRecord(payload.lesson, "workspaceEvent.payload.lesson");
    if (type === "learning.lesson.candidate" && lesson.lifecycle !== "candidate") fail("workspaceEvent.payload.lesson.lifecycle", "candidate event must carry candidate lifecycle");
    return { lesson };
  }
  if (type === "learning.experiment.completed") return { experiment: parseLearningExperiment(payload.experiment, "workspaceEvent.payload.experiment") };
  if (["skill.candidate", "skill.status_changed"].includes(type)) {
    const skill = parseSkillRecord(payload.skill, "workspaceEvent.payload.skill");
    if (type === "skill.candidate" && skill.lifecycle !== "candidate") fail("workspaceEvent.payload.skill.lifecycle", "candidate event must carry candidate lifecycle");
    return { skill };
  }
  if (type === "skill.version.created" || type === "skill.rolled_back") {
    const result = { skill: parseSkillRecord(payload.skill, "workspaceEvent.payload.skill") };
    if (type === "skill.version.created") result.changeSummary = text(payload.changeSummary, "workspaceEvent.payload.changeSummary", 500);
    else result.rollbackTo = text(payload.rollbackTo, "workspaceEvent.payload.rollbackTo", 40);
    return result;
  }
  if (type === "approval.requested" || type === "approval.resolved") {
    const approval = parseApprovalRecord(payload.approval, "workspaceEvent.payload.approval");
    if (type === "approval.requested" && approval.status !== "pending") fail("workspaceEvent.payload.approval.status", "requested approvals must be pending");
    if (type === "approval.resolved" && approval.status === "pending") fail("workspaceEvent.payload.approval.status", "resolved approvals cannot be pending");
    return { approval };
  }
  return null;
}

export function parseWorkspaceEvent(eventName, value, sseId) {
  const item = object(value, "workspaceEvent");
  const bodyType = typeof item.type === "string" ? item.type : undefined;
  const hasKnownType = WORKSPACE_EVENT_TYPES.includes(eventName) || WORKSPACE_EVENT_TYPES.includes(bodyType);
  if (!hasKnownType) return null;
  const type = bodyType ?? eventName;
  if (!bodyType || eventName !== type) fail("workspaceEvent.type", "SSE event name and JSON type must match");
  if (item.contractVersion !== CONTRACT_VERSION) fail("workspaceEvent.contractVersion", `expected version ${CONTRACT_VERSION}`);
  const id = identifier(item.id, "workspaceEvent.id");
  if (sseId !== id) fail("workspaceEvent.id", "SSE id and JSON id must match");
  if (!Number.isSafeInteger(item.sequence) || item.sequence < 1) fail("workspaceEvent.sequence", "expected a positive safe integer");
  const source = enumValue(item.source, "workspaceEvent.source", WORKSPACE_EVENT_SOURCE_SET);
  if (item.approvalId === undefined) fail("workspaceEvent.approvalId", "expected an approval ID or null");
  const approvalId = item.approvalId === null ? null : identifier(item.approvalId, "workspaceEvent.approvalId");
  const scope = parseMemoryScope(item.scope, "workspaceEvent.scope");
  const payload = normalizeWorkspacePayload(type, item.payload);
  if (["memory.created", "memory.updated", "memory.lifecycle_changed"].includes(type)) requireEventScopeMatch(scope, payload.memory.scope, "workspaceEvent.payload.memory.scope");
  if (type === "memory.forgotten") requireEventScopeMatch(scope, payload.scope, "workspaceEvent.payload.scope");
  if (["knowledge.source.ingested", "knowledge.source.stale", "knowledge.source.superseded"].includes(type)) requireEventScopeMatch(scope, payload.source.scope, "workspaceEvent.payload.source.scope");
  if (["knowledge.item.extracted", "knowledge.item.superseded"].includes(type)) requireEventScopeMatch(scope, payload.item.scope, "workspaceEvent.payload.item.scope");
  if (["knowledge.relation.created", "knowledge.relation.invalidated"].includes(type)) requireEventScopeMatch(scope, payload.relation.scope, "workspaceEvent.payload.relation.scope");
  if (type === "knowledge.retrieved" && payload.items.some((knowledgeItem) => !scopesMatch(scope, knowledgeItem.scope))) fail("workspaceEvent.payload.items", "all retrieved items must match the workspace event scope");
  if (["learning.lesson.candidate", "learning.lesson.status_changed"].includes(type)) requireEventScopeMatch(scope, payload.lesson.scope, "workspaceEvent.payload.lesson.scope");
  if (["skill.candidate", "skill.status_changed", "skill.version.created", "skill.rolled_back"].includes(type)) requireEventScopeMatch(scope, payload.skill.scope, "workspaceEvent.payload.skill.scope");
  if (type === "learning.experience.recorded" && ((scope.type === "task" && payload.experience.taskId !== scope.id) || (scope.type === "project" && payload.experience.projectId !== scope.id))) fail("workspaceEvent.payload.experience", "experience identifiers must match the workspace event scope");
  if (type === "learning.evaluation.completed" && scope.type === "task" && payload.evaluation.taskId !== scope.id) fail("workspaceEvent.payload.evaluation.taskId", "must match the workspace event task scope");
  if ((type === "approval.requested" || type === "approval.resolved") && approvalId !== payload.approval.id) {
    fail("workspaceEvent.approvalId", "approval events must reference their approval record");
  }
  if (type === "learning.lesson.status_changed" && ["approved", "active"].includes(payload.lesson.lifecycle) && approvalId !== payload.lesson.approvalId) {
    fail("workspaceEvent.approvalId", "approved or active lesson events must reference the authorizing approval");
  }
  if (["skill.status_changed", "skill.version.created", "skill.rolled_back"].includes(type) && payload.skill.lifecycle === "active" && approvalId !== payload.skill.approvalId) {
    fail("workspaceEvent.approvalId", "active skill events must reference the authorizing approval");
  }
  return {
    contractVersion: CONTRACT_VERSION,
    id,
    sequence: item.sequence,
    occurredAt: timestamp(item.occurredAt, "workspaceEvent.occurredAt"),
    scope,
    type,
    source,
    approvalId,
    payload,
  };
}

export const learningContract = Object.freeze({
  version: CONTRACT_VERSION,
  taskEventTypes: LEARNING_TASK_EVENT_TYPES,
  workspaceEventTypes: WORKSPACE_EVENT_TYPES,
  workspaceEventSources: WORKSPACE_EVENT_SOURCES,
  memoryKinds: Object.freeze([...MEMORY_KINDS]),
  memoryLifecycles: Object.freeze([...MEMORY_LIFECYCLES]),
  knowledgeRelationPredicates: Object.freeze([...KNOWLEDGE_RELATION_PREDICATES]),
  lessonLifecycles: Object.freeze([...LESSON_LIFECYCLES]),
  skillLifecycles: Object.freeze([...SKILL_LIFECYCLES]),
});

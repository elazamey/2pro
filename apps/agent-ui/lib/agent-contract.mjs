import { LEARNING_TASK_EVENT_TYPES, parseLearningTaskEventPayload } from "./learning-contract.mjs";

const CONTRACT_VERSION = "1";
const TASK_STATUSES = new Set(["queued", "planning", "running", "waiting_approval", "completed", "failed", "cancelled"]);
const STEP_STATUSES = new Set(["pending", "running", "done", "error", "blocked"]);
const MESSAGE_ROLES = new Set(["user", "assistant", "tool"]);
const ARTIFACT_KINDS = new Set(["document", "image", "code", "data", "other"]);
const EXECUTION_EVENT_TYPES = new Set([
  "task.started",
  "task.planning",
  "tool.started",
  "tool.progress",
  "tool.output",
  "approval.required",
  "artifact.created",
  "task.completed",
  "task.failed",
  ...LEARNING_TASK_EVENT_TYPES,
]);

const LIMITS = Object.freeze({
  id: 160,
  title: 160,
  description: 2_000,
  prompt: 8_000,
  message: 8_000,
  steps: 100,
  messages: 500,
  artifacts: 100,
});

export class ContractValidationError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "ContractValidationError";
    this.path = path;
  }
}

function record(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractValidationError(path, "expected an object");
  }
  return value;
}

function boundedString(value, path, max = LIMITS.description, { allowEmpty = false } = {}) {
  if (typeof value !== "string") throw new ContractValidationError(path, "expected a string");
  const trimmed = value.trim();
  if (!allowEmpty && !trimmed) throw new ContractValidationError(path, "must not be empty");
  if (trimmed.length > max) throw new ContractValidationError(path, `must be at most ${max} characters`);
  return trimmed;
}

function timestamp(value, path) {
  const isoTimestamp = typeof value === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value);
  if (!isoTimestamp || !Number.isFinite(Date.parse(value))) {
    throw new ContractValidationError(path, "expected an ISO-8601 timestamp with timezone");
  }
  return new Date(value).toISOString();
}

function array(value, path, max, normalizeItem) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ContractValidationError(path, "expected an array");
  if (value.length > max) throw new ContractValidationError(path, `must contain at most ${max} items`);
  return value.map((item, index) => normalizeItem(item, `${path}[${index}]`));
}

function normalizeTaskStep(value, path) {
  const item = record(value, path);
  const status = boundedString(item.status, `${path}.status`, 24);
  if (!STEP_STATUSES.has(status)) throw new ContractValidationError(`${path}.status`, "unsupported step status");
  const result = {
    id: boundedString(item.id, `${path}.id`, LIMITS.id),
    title: boundedString(item.title, `${path}.title`, LIMITS.title),
    description: boundedString(item.description ?? "", `${path}.description`, LIMITS.description, { allowEmpty: true }),
    status,
  };
  if (item.toolCallId !== undefined) result.toolCallId = boundedString(item.toolCallId, `${path}.toolCallId`, LIMITS.id);
  if (item.startedAt !== undefined) result.startedAt = timestamp(item.startedAt, `${path}.startedAt`);
  if (item.finishedAt !== undefined) result.finishedAt = timestamp(item.finishedAt, `${path}.finishedAt`);
  return result;
}

function normalizeTaskMessage(value, path) {
  const item = record(value, path);
  const role = boundedString(item.role, `${path}.role`, 16);
  if (!MESSAGE_ROLES.has(role)) throw new ContractValidationError(`${path}.role`, "unsupported message role");
  return {
    id: boundedString(item.id, `${path}.id`, LIMITS.id),
    role,
    content: boundedString(item.content, `${path}.content`, LIMITS.message, { allowEmpty: true }),
    createdAt: timestamp(item.createdAt, `${path}.createdAt`),
  };
}

function normalizeArtifact(value, path) {
  const item = record(value, path);
  const kind = boundedString(item.kind, `${path}.kind`, 24);
  if (!ARTIFACT_KINDS.has(kind)) throw new ContractValidationError(`${path}.kind`, "unsupported artifact kind");
  const result = {
    id: boundedString(item.id, `${path}.id`, LIMITS.id),
    name: boundedString(item.name, `${path}.name`, LIMITS.title),
    kind,
    createdAt: timestamp(item.createdAt, `${path}.createdAt`),
  };
  if (item.mimeType !== undefined) result.mimeType = boundedString(item.mimeType, `${path}.mimeType`, 120);
  if (item.sizeBytes !== undefined) {
    if (!Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 0) {
      throw new ContractValidationError(`${path}.sizeBytes`, "expected a non-negative safe integer");
    }
    result.sizeBytes = item.sizeBytes;
  }
  return result;
}

export function parseTask(value) {
  const item = record(value, "task");
  if (item.contractVersion !== CONTRACT_VERSION) {
    throw new ContractValidationError("task.contractVersion", `expected version ${CONTRACT_VERSION}`);
  }
  const status = boundedString(item.status, "task.status", 32);
  if (!TASK_STATUSES.has(status)) throw new ContractValidationError("task.status", "unsupported task status");
  const projectId = item.projectId == null ? null : boundedString(item.projectId, "task.projectId", LIMITS.id);
  return {
    contractVersion: CONTRACT_VERSION,
    id: boundedString(item.id, "task.id", LIMITS.id),
    projectId,
    title: boundedString(item.title, "task.title", LIMITS.title),
    prompt: boundedString(item.prompt ?? "", "task.prompt", LIMITS.prompt, { allowEmpty: true }),
    status,
    messages: array(item.messages, "task.messages", LIMITS.messages, normalizeTaskMessage),
    steps: array(item.steps, "task.steps", LIMITS.steps, normalizeTaskStep),
    artifacts: array(item.artifacts, "task.artifacts", LIMITS.artifacts, normalizeArtifact),
    createdAt: timestamp(item.createdAt, "task.createdAt"),
    updatedAt: timestamp(item.updatedAt, "task.updatedAt"),
  };
}

export function parseProject(value) {
  const item = record(value, "project");
  if (item.contractVersion !== CONTRACT_VERSION) {
    throw new ContractValidationError("project.contractVersion", `expected version ${CONTRACT_VERSION}`);
  }
  return {
    contractVersion: CONTRACT_VERSION,
    id: boundedString(item.id, "project.id", LIMITS.id),
    name: boundedString(item.name, "project.name", LIMITS.title),
    description: boundedString(item.description ?? "", "project.description", LIMITS.description, { allowEmpty: true }),
    instructions: boundedString(item.instructions ?? "", "project.instructions", LIMITS.description, { allowEmpty: true }),
    createdAt: timestamp(item.createdAt, "project.createdAt"),
    updatedAt: timestamp(item.updatedAt, "project.updatedAt"),
  };
}

function normalizeEventPayload(type, value) {
  const payload = record(value, `event.payload`);
  if (type === "task.started") {
    const status = payload.status === undefined ? "running" : boundedString(payload.status, "event.payload.status", 32);
    if (!["planning", "running"].includes(status)) throw new ContractValidationError("event.payload.status", "expected planning or running");
    return { status };
  }
  if (type === "task.planning") {
    return { steps: array(payload.steps, "event.payload.steps", LIMITS.steps, normalizeTaskStep) };
  }
  if (type === "tool.started") {
    return {
      toolCallId: boundedString(payload.toolCallId, "event.payload.toolCallId", LIMITS.id),
      toolName: boundedString(payload.toolName, "event.payload.toolName", LIMITS.title),
      title: boundedString(payload.title ?? payload.toolName, "event.payload.title", LIMITS.title),
      description: boundedString(payload.description ?? "", "event.payload.description", LIMITS.description, { allowEmpty: true }),
    };
  }
  if (type === "tool.progress") {
    const result = { toolCallId: boundedString(payload.toolCallId, "event.payload.toolCallId", LIMITS.id) };
    if (payload.message !== undefined) result.message = boundedString(payload.message, "event.payload.message", LIMITS.description, { allowEmpty: true });
    if (payload.percent !== undefined) {
      if (!Number.isFinite(payload.percent) || payload.percent < 0 || payload.percent > 100) {
        throw new ContractValidationError("event.payload.percent", "expected a number from 0 to 100");
      }
      result.percent = payload.percent;
    }
    return result;
  }
  if (type === "tool.output") {
    const result = { toolCallId: boundedString(payload.toolCallId, "event.payload.toolCallId", LIMITS.id) };
    if (payload.summary !== undefined) result.summary = boundedString(payload.summary, "event.payload.summary", LIMITS.description, { allowEmpty: true });
    return result;
  }
  if (type === "approval.required") {
    const result = {
      approvalId: boundedString(payload.approvalId, "event.payload.approvalId", LIMITS.id),
      action: boundedString(payload.action, "event.payload.action", LIMITS.title),
      reason: boundedString(payload.reason ?? "", "event.payload.reason", LIMITS.description, { allowEmpty: true }),
    };
    if (payload.expiresAt !== undefined) result.expiresAt = timestamp(payload.expiresAt, "event.payload.expiresAt");
    return result;
  }
  if (type === "artifact.created") {
    return { artifact: normalizeArtifact(payload.artifact, "event.payload.artifact") };
  }
  if (type === "task.completed") {
    const result = {};
    if (payload.summary !== undefined) result.summary = boundedString(payload.summary, "event.payload.summary", LIMITS.description, { allowEmpty: true });
    if (payload.steps !== undefined) result.steps = array(payload.steps, "event.payload.steps", LIMITS.steps, normalizeTaskStep);
    return result;
  }
  if (type === "task.failed") {
    const error = record(payload.error, "event.payload.error");
    const retryable = error.retryable;
    if (typeof retryable !== "boolean") throw new ContractValidationError("event.payload.error.retryable", "expected a boolean");
    return {
      error: {
        code: boundedString(error.code ?? "AGENT_FAILED", "event.payload.error.code", 80),
        message: boundedString(error.message, "event.payload.error.message", LIMITS.description),
        retryable,
      },
    };
  }
  const learningPayload = parseLearningTaskEventPayload(type, value);
  if (learningPayload) return learningPayload;
  return null;
}

export function parseExecutionEvent(eventName, value) {
  const bodyType = value && typeof value === "object" && !Array.isArray(value) && typeof value.type === "string"
    ? value.type
    : undefined;
  const hasKnownType = EXECUTION_EVENT_TYPES.has(eventName) || EXECUTION_EVENT_TYPES.has(bodyType);
  if (!hasKnownType) return null;
  const type = bodyType ?? eventName;
  if (!bodyType || eventName !== type) {
    throw new ContractValidationError("event.type", "SSE event name and JSON type must match");
  }
  const item = record(value, "event");
  if (item.contractVersion !== CONTRACT_VERSION) {
    throw new ContractValidationError("event.contractVersion", `expected version ${CONTRACT_VERSION}`);
  }
  if (!Number.isSafeInteger(item.sequence) || item.sequence < 1) {
    throw new ContractValidationError("event.sequence", "expected a positive safe integer");
  }
  const taskId = boundedString(item.taskId, "event.taskId", LIMITS.id);
  const payload = normalizeEventPayload(type, item.payload);
  if (type === "learning.experience.recorded" && payload.experience.taskId !== taskId) {
    throw new ContractValidationError("event.payload.experience.taskId", "must match the event taskId");
  }
  if (type === "learning.evaluation.completed" && payload.evaluation.taskId !== taskId) {
    throw new ContractValidationError("event.payload.evaluation.taskId", "must match the event taskId");
  }
  return {
    contractVersion: CONTRACT_VERSION,
    id: boundedString(item.id, "event.id", LIMITS.id),
    taskId,
    sequence: item.sequence,
    occurredAt: timestamp(item.occurredAt, "event.occurredAt"),
    type,
    payload,
  };
}

export function parseSseFrame(frame) {
  let event = "message";
  let id;
  const dataLines = [];
  for (const line of String(frame).split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim() || "message";
    else if (line.startsWith("id:")) id = line.slice(3).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!dataLines.length) return null;
  const raw = dataLines.join("\n");
  if (raw === "[DONE]") return { event: "done", id, data: {} };
  try {
    return { event, id, data: JSON.parse(raw) };
  } catch {
    return { event, id, data: { text: raw } };
  }
}

export const taskContract = Object.freeze({
  version: CONTRACT_VERSION,
  taskStatuses: Object.freeze([...TASK_STATUSES]),
  stepStatuses: Object.freeze([...STEP_STATUSES]),
  eventTypes: Object.freeze([...EXECUTION_EVENT_TYPES]),
});

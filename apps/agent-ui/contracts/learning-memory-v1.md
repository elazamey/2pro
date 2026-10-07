# Learning, Memory, Knowledge & Skills contract — v1 draft

This contract specifies the data and protocol boundary for experience-based improvement. “Learning” here means **recording outcomes, evaluating them, testing reusable lessons, and promoting only evidence-backed changes**. It does not mean changing model weights.

This is a normative contract plus a read-only frontend consumer. It does **not** implement a durable database, an ingestion pipeline, a reflection/evaluation model, a vector or graph index, a sandbox, or the `/v1` APIs below. The browser only receives records the agent service sends in validated SSE events; it must not invent memories or claim to have learned from a task.

The machine-readable schema is [`learning-memory-v1.schema.json`](./learning-memory-v1.schema.json). The current execution contract remains in [`agent-platform-v1.md`](./agent-platform-v1.md).

## 1. Separate concepts

| Concept | Contract representation | Meaning |
|---|---|---|
| Working memory | Runtime-only task context; **not** a `MemoryRecord` | Current plan, recent messages and tool results. Discard at task end; never a durable retrieval source. |
| Episodic memory | `MemoryRecord.kind = episodic`, `scope.type = task` or `project` | A bounded, redacted account of a task outcome, linked to evidence. |
| Semantic memory | `MemoryRecord.kind = semantic` | A sourced fact or rule that is useful beyond one task. |
| Procedural memory | `MemoryRecord.kind = procedural` or a `LessonRecord` | A reusable “how to” supported by experiments and task evidence. |
| Preference memory | `MemoryRecord.kind = preference` | A user/workspace preference. It must come from an explicit user instruction or confirmation, never inference alone. |
| Knowledge | `KnowledgeSource` + cited `KnowledgeItem` + `KnowledgeRelation` | Versioned facts, procedures, API details, schemas, constraints, warnings, architecture and typed graph edges extracted from documents or other sources. |
| Learning | `LearningExperience`, `Evaluation`, `LessonRecord`, `Experiment` | The evidence and lifecycle that can justify a change to memory or a skill. |
| Skill | `SkillRecord` and immutable skill versions | A packaged capability. It is not the same as a lesson or a memory record. |
| Provenance | `SourceReference` and citations | What the system knows, where it came from, and which source version supports it. |

Project, user and organization “memory” are **scopes**, not separate untyped stores. Every query and record carries a scope. Cross-scope copying is a permissioned promotion, not retrieval by accident.

## 2. Versioning and common rules

- All records use `contractVersion: "1"`; IDs are opaque strings. Clients do not manufacture IDs or infer identity from them.
- Timestamps are ISO-8601 with a timezone. `revision` is a positive integer and changes on every update; mutations use optimistic concurrency (`If-Match`).
- `confidence` is a calibrated display/ranking signal in `[0,1]`, **not** proof, permission, or a promotion gate by itself.
- Every durable memory and extracted knowledge item carries provenance. Knowledge items carry one or more citations (`sourceId`, a stable locator, and optionally a short quotation/page).
- Content fields are bounded and user-safe. Never persist chain-of-thought, hidden prompts, credentials, raw private reasoning, unredacted tool output, or untrusted HTML. Store a short structured outcome summary instead.
- Unknown versions and malformed records/events are rejected. An unknown event type is ignored only when neither its SSE name nor body claims a v1 learning type.

## 3. Records and logical tables

The following are logical table boundaries, not a claim that a database currently exists. A backend may choose relational tables or equivalent storage, but it must preserve the keys, revisions, source links, scope isolation, and deletion behavior.

| Logical table | Key fields / constraints |
|---|---|
| `task_experiences` | `id`, unique `task_id` (or unique `(task_id, evaluator_version)` where retries are intentionally separate), `project_id`, outcome, sanitized summary, strategies, `captured_at`, `expires_at`; no raw transcript column. |
| `evaluations` | `id`, `experience_id`, evaluator version, correctness/completeness/efficiency/policy scores, optional user score; one immutable result per evaluator version. |
| `memories` | `id`, scope `(type,id)`, kind, lifecycle, confidence, `source_refs`, evidence counters, revision and retention dates. Retrieval index is derived and must be purgeable. |
| `memory_evidence` | `id`, `memory_id`, `task_id`, outcome, strategy and short sanitized summary; distinct task IDs are counted as independent evidence. |
| `knowledge_sources` | `id`, scope, kind, canonical URI or upload reference, source version/checksum, published/retrieved/synced timestamps and ingestion status. Uniqueness is by scope + canonical source + source version. |
| `knowledge_items` | `id`, `source_id`, `source_version`, structured kind/content, citations, validity range, lifecycle and revision. A source update does not silently overwrite old evidence. |
| `knowledge_relations` | Typed `subject → predicate → object` edges scoped to a project/user/org, with confidence, source references, lifecycle and revision; invalidated edges are excluded from impact queries. |
| `lessons` | `id`, kind, trigger, recommendation, scope, lifecycle, evidence/source references, confidence and revision. Approved/active lessons carry the attributable `approval_id`; candidate lessons are not default retrieval. |
| `experiments` | `id`, target lesson/skill, isolated-sandbox mode, baseline/candidate run counts and results; production-side-effect runs are forbidden. |
| `skills` / `skill_versions` | Stable skill identity plus immutable, versioned definitions, provenance, tests, evaluation history and activation state. Active versions carry an attributable `approval_id`; rollback points to a prior immutable version. |
| `approvals` | Subject/action, requester, approver, status, timestamps and reason. Approval is scoped, attributable, and cannot be inferred from a positive task score. |
| `workspace_event_outbox` | Durable event ID, per-scope sequence, scope, type, payload reference and creation time. Append-only, used for replayable SSE. |
| `forget_tombstones` | Opaque subject ID, scope, request ID and purge state only. Never retain forgotten content in the tombstone or audit payload. |

### Record shapes

The JSON Schema is authoritative. The principal shapes are:

```json
{
  "contractVersion": "1",
  "id": "mem_opaque_id",
  "kind": "preference",
  "title": "Reply language",
  "content": "Prefer Arabic responses unless asked otherwise.",
  "scope": { "type": "user", "id": "user_opaque_id" },
  "lifecycle": "trusted",
  "confidence": 1,
  "sourceRefs": [{ "kind": "user", "sourceId": "feedback_opaque_id" }],
  "evidenceStats": { "observations": 1, "successes": 1, "failures": 0, "verificationCount": 0 },
  "revision": 1,
  "createdAt": "2026-10-06T12:00:00.000Z",
  "updatedAt": "2026-10-06T12:00:00.000Z",
  "lastUsedAt": null,
  "expiresAt": null
}
```

```json
{
  "contractVersion": "1",
  "id": "knowledge_opaque_id",
  "sourceId": "source_opaque_id",
  "sourceVersion": "4.2.1",
  "kind": "api_endpoint",
  "title": "Create task",
  "statement": "POST /v1/tasks accepts title and project_id.",
  "scope": { "type": "project", "id": "project_opaque_id" },
  "lifecycle": "verified",
  "confidence": 0.98,
  "citations": [{ "sourceId": "source_opaque_id", "locator": "API reference / Tasks / Create", "page": 12 }],
  "validFrom": "2026-10-06T12:00:00.000Z",
  "validUntil": null,
  "createdAt": "2026-10-06T12:05:00.000Z",
  "updatedAt": "2026-10-06T12:05:00.000Z",
  "revision": 1
}
```

A `KnowledgeRelation` is an explicit graph edge such as `{ "subject": {"kind":"project","id":"project_1"}, "predicate":"uses", "object": {"kind":"technology","id":"Hono"} }`. It carries scope, confidence, provenance and lifecycle; inferred edges start as candidates and are not used for impact decisions until verified.

`LearningExperience` is a sanitized, bounded task outcome (`success`, `partial`, `failure`, `cancelled`) with strategy attempts and provenance. `Evaluation` scores correctness, completeness, efficiency and policy compliance independently; `userSatisfaction` is `null` until the user supplies feedback. A `LessonRecord` holds a trigger, recommendation, scope and distinct task evidence; approved/active records reference the approval that authorized the transition. An `Experiment` identifies its target and sandbox and reports baseline/candidate runs. A `SkillRecord` carries a version, tests, provenance, lifecycle, whether approval is still required and (when active) its approval reference. Full definitions and constraints are in the schema.

## 4. Lifecycle rules

### Memory

```text
observed → candidate → learned → verified → trusted
                     ↘ stale → archived
                     ↘ archived
```

- `observed` is a signal, not yet reusable advice. `candidate` is visible for review but excluded from automatic retrieval. `learned` means a lesson was formed from evidence; it is still advisory. `verified` means its evidence passed the applicable verification gate. `trusted` is the only default-eligible durable lifecycle for cross-task reuse, subject to scope and permission.
- `stale` is immediately excluded from retrieval when evidence/source versions expire or conflict. Revalidation creates a new revision and fresh evidence; it does not erase history.
- `archived` is excluded from retrieval. `forgotten` is represented only by a `memory.forgotten` tombstone event, not by a content-bearing memory row.
- A project-scoped memory never becomes user- or organization-scoped by implicit inheritance. Scope changes require an approval record and a new provenance edge.

### Knowledge and documents

```text
source: queued → indexing → ready → stale → superseded/archived
item:   candidate → verified → stale → superseded/archived
```

Ingestion stores source identity/version, checksum, published time when available, retrieved time, and citation locators. A changed checksum/version creates a new source revision; affected knowledge items become `stale` and leave default retrieval until re-indexed and re-verified. Unsupported statements remain candidates. Every answer based on imported knowledge should be able to surface its source and locator.

### Learning, experiments and skills

```text
experience → evaluation → lesson candidate → testing → verified → approved → active
                                                        ↘ failed/rejected/stale/archived
skill candidate → review → active → deprecated/archived
```

Experiences are not automatically promoted. Evaluations are versioned evidence, not truth. Lessons must be tested in an isolated or synthetic sandbox with a baseline. Skills use immutable versions; the active pointer changes only after test/evaluation and the approval policy. Failed experiments remain evidence and lower confidence rather than being deleted.

## 5. API contract

All endpoints below are **proposed `/v1` service APIs**, not implemented routes in this Next.js app.

### Transport, authorization and errors

- The existing browser adapter `POST /api/chat` accepts `learningConsent: boolean` (omission means `false`), validates it and forwards it server-to-server. It is a per-task consent signal, not a persistence acknowledgement; demo mode retains nothing.
- Require authenticated server-to-server identity and authorize every request against the requested `scope`; never send service credentials to browser code.
- Writes accept `Idempotency-Key`; updates require `If-Match: <revision>`. A stale revision returns `409 REVISION_CONFLICT` with the current revision, not a silent overwrite.
- JSON errors have `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`. Use `400` invalid contract, `401/403` auth/scope, `404` unknown ID, `409` conflict/lifecycle, `413` bound exceeded, `422` failed evidence/policy gate, `429` quota, and `5xx` transient service error.
- List endpoints are cursor-paginated and have a server-enforced maximum page size. Ingestion and experiments return `202` with a resource ID; completion arrives through events.

### Memory and retrieval

| Method and path | Request / response contract |
|---|---|
| `GET /v1/memories?scopeType=&scopeId=&kind=&lifecycle=&cursor=` | Authorized, paginated `MemoryRecord[]`; excludes forgotten records. Candidate visibility requires review permission. |
| `POST /v1/memory/query` | `{ query, scopes:[Scope], kinds?:[], limit?:1..30, includeCandidates?:false }` → `{ queryId, memories: MemoryRecord[], truncated }`; filters by permission and lifecycle **before** relevance ranking. Default lifecycle is `verified` and `trusted`. |
| `POST /v1/memories` | Explicit user-authored memory or reviewed candidate. Body is a `MemoryRecord` without server fields; preference records require `sourceRefs.kind=user`. Starts no higher than `candidate`, except a directly confirmed preference may be `trusted` in that same user scope. |
| `GET /v1/memories/{id}` | One authorized, non-forgotten record and provenance. |
| `PATCH /v1/memories/{id}` | Editable text/metadata only; lifecycle changes use transition endpoints. Requires `If-Match`; returns the new revision and `memory.updated`. |
| `POST /v1/memories/{id}/promote` | `{ targetLifecycle:"verified"|"trusted", evidenceIds:[], approvalId?:string }`; server validates experiment/evidence, scope and approval policy before transition. |
| `POST /v1/memories/{id}/forget` | `{ reasonCode?:string }`; idempotently tombstones immediately, revokes retrieval eligibility, and queues purge of content, embeddings, caches and derived records. Response contains only `{ memoryId, forgottenAt, purgeState }`. |
| `POST /v1/memory/forget` | `{ scope: Scope, kinds?:[] }`; owner-authorized bulk forget with a per-ID result list, never a silent broad delete. |

### Learning, knowledge and skills

| Method and path | Request / response contract |
|---|---|
| `POST /v1/learning/experiences` | Service-authenticated sanitized `LearningExperience`; idempotent by `taskId`. Rejects raw transcript/reasoning fields. |
| `POST /v1/learning/evaluations` | `{ experienceId, evaluatorVersion, scores, policyFindings, userFeedback? }` → immutable `Evaluation`; user score may be null. |
| `POST /v1/learning/lessons` | `{ kind, trigger, recommendation, scope, evidenceIds, sourceRefs }` → `LessonRecord` with lifecycle `candidate`; evidence IDs must resolve in the same authorized scope. |
| `POST /v1/learning/lessons/{id}/experiments` | `{ sandbox:"synthetic"|"isolated", baselineRuns, candidateRuns }` → `202 Experiment`; production credentials/side effects are unavailable. |
| `POST /v1/learning/lessons/{id}/promote` | `{ targetLifecycle:"verified"|"approved"|"active", approvalId? }`; each transition has its own evidence/approver gate. |
| `POST /v1/knowledge/sources` | `{ kind, title, canonicalUri?, version?, scope }` → `202 KnowledgeSource`; URL fetching is server-side, HTTPS-only, SSRF-protected, size/time bounded and allowlistable. |
| `POST /v1/knowledge/sources/{id}/ingest` | `{ expectedRevision }` → `202`; returns source/version and emits ingestion/indexing events. |
| `GET /v1/knowledge/sources/{id}` / `GET /v1/knowledge/items?sourceId=&scopeType=&scopeId=` | Authorized versioned source and cited items, cursor-paginated. |
| `GET /v1/knowledge/relations?entityKind=&entityId=&scopeType=&scopeId=` | Authorized, cursor-paginated `KnowledgeRelation[]` edges for impact/graph queries; only verified current edges are included by default. |
| `GET /v1/skills?scopeType=&scopeId=&lifecycle=` | Authorized skill metadata and immutable version references. |
| `POST /v1/skills/{id}/approve` | `{ version, approvalId }`; verifies tests and approval identity before changing the active version pointer. |
| `POST /v1/skills/{id}/rollback` | `{ toVersion, reason }`; owner approval required; emits a rollback event and preserves both versions. |
| `GET /v1/events?scopeType=&scopeId=` | `text/event-stream` for authorized workspace events; supports `Last-Event-ID` replay and sequence dedupe. |

## 6. Events

### Task stream events

Learning events inside `/api/chat` use the existing **task execution envelope** from `agent-platform-v1.md`: `contractVersion`, `id`, `taskId`, contiguous `sequence`, `occurredAt`, `type`, and `payload`. `event:` must equal JSON `type`; `id:` must equal JSON `id`. They are emitted before the terminal `task.completed`/`task.failed` event.

| Event | Payload |
|---|---|
| `memory.retrieved` | `{ queryId, memories: MemoryRecord[], truncated }` |
| `knowledge.retrieved` | `{ queryId, items: KnowledgeItem[], truncated }` |
| `knowledge.relations_retrieved` | `{ queryId, relations: KnowledgeRelation[], truncated }` |
| `knowledge.source.consulted` | `{ source: KnowledgeSource }` |
| `learning.experience.recorded` | `{ experience: LearningExperience }` |
| `learning.evaluation.completed` | `{ evaluation: Evaluation }` |
| `learning.lesson.candidate` / `learning.lesson.status_changed` | `{ lesson: LessonRecord }` (full bounded snapshot) |
| `learning.experiment.completed` | `{ experiment: Experiment }` |
| `skill.candidate` / `skill.status_changed` | `{ skill: SkillRecord }` (metadata only; never executable skill code) |

### Workspace stream events

Global lifecycle, approval, and forgetting events use a distinct envelope:

```json
{
  "contractVersion": "1",
  "id": "event_opaque_id",
  "sequence": 42,
  "occurredAt": "2026-10-06T12:00:00.000Z",
  "scope": { "type": "project", "id": "project_opaque_id" },
  "type": "memory.forgotten",
  "source": "user",
  "approvalId": null,
  "payload": {
    "memoryId": "mem_opaque_id",
    "scope": { "type": "project", "id": "project_opaque_id" },
    "forgottenAt": "2026-10-06T12:00:00.000Z",
    "tombstoneId": "tombstone_opaque_id"
  }
}
```

`source` is one of `agent`, `user`, `system`, `connector`, `scheduler`, or `service`. `approvalId` is always present and is `null` unless the event is tied to an approval; approval events must repeat the approval record ID, and approved/active lesson or skill transitions must identify the authorizing approval.

The in-process `WorkspaceEventBus` validates each envelope, allocates monotonically increasing sequence numbers per scope, provides bounded replay by sequence/event ID, isolates subscriptions by exact scope, and emits standards-shaped SSE frames. Its ring buffers and counters exist only in that process: the bus is not backed by an outbox, is not connected to an HTTP route or UI, and provides no authentication or persistence. Restarts lose its history. A gateway must authorize every publish/subscribe scope before using this library; the bus itself is not an authorization boundary. A durable cross-process gateway remains a later persistence/auth integration, not a property of this R1 component.

The workspace sequence is monotonic per authorized scope stream; a replay cursor older than the retained window is rejected rather than silently skipped, and record scopes must match the event envelope. `memory.forgotten` intentionally carries **no forgotten content**. Event names include `memory.created`, `memory.updated`, `memory.lifecycle_changed`, `memory.forgotten`, `knowledge.source.ingested|stale|superseded`, `knowledge.item.extracted|superseded`, `knowledge.relation.created|invalidated`, `knowledge.retrieved`, `learning.experience.recorded`, `learning.evaluation.completed`, `learning.lesson.candidate|status_changed`, `learning.experiment.completed`, `skill.candidate|status_changed|version.created|rolled_back`, and `approval.requested|resolved`.

## 7. Confidence, approval and promotion policy

The v1 safe default is `manual_only` for promotion and skill activation.

1. **Observe:** retain only structured, bounded, redacted outcome and strategy summaries when workspace/task learning consent is enabled. Working context expires at task completion; no raw reasoning is retained.
2. **Evaluate:** score correctness, completeness, efficiency and policy compliance separately. Do not fabricate a user-satisfaction score. A thumbs-up alone is not a lesson or approval.
3. **Candidate:** create a lesson only with traceable task/source evidence. Candidates are visible in review but excluded from automatic retrieval or tool planning.
4. **Verify:** a reusable strategy needs evidence from at least three distinct task IDs and a held-out sandbox experiment with at least three candidate runs, at least 90% passing runs, no regression against baseline, and zero policy violations. These initial thresholds are server policy and may be tightened; a confidence score cannot waive them. Document-derived knowledge is verified against the cited, current source version instead of task-repeat counts.
5. **Approve/promote:** user preferences require explicit confirmation. `trusted` memory, organization-scope sharing, active skills and any change to tool policy require a named owner/authorized approver. The requester cannot approve their own scope escalation. A passing experiment is necessary but not sufficient.
6. **Use:** retrieval applies authorization and scope filters first; only `verified`/`trusted` current records are default context. Lessons and memory inform proposals; they never bypass connector permissions, tool policy, or per-action approval.
7. **Revise/rollback:** edits create a new revision. Skills keep immutable versions and can roll back. A source change, contradictory evidence, policy change or expiry makes derived knowledge/memory stale and removes it from retrieval until revalidated.

## 8. Forgetting, retention and source invalidation

- Default learning consent is **off** until an authenticated workspace owner/user enables it. The UI must show the selected scope and learning setting before a task is retained.
- Working memory and raw tool output are not durable. Sanitized episodic experience has a default 90-day TTL unless the workspace policy is shorter. User-authored preference memory has no implicit TTL but remains user-editable and deletable. Organization retention may be shorter; it cannot silently extend a user deletion request.
- Forget is immediate for retrieval: write a tombstone, invalidate caches/vector indexes, cancel pending promotions/experiments that depend on the memory, and mark derived lessons/items stale. Purge primary content and derived indexes within 24 hours; backup expiry is documented by the service retention policy. Keep only an opaque tombstone/request ID necessary to prevent resurrection and prove deletion.
- A forgotten ID is never rehydrated from event replay or backups. Re-learning requires a new explicit source/evidence record. API forget is idempotent. Forgetting a source also invalidates all derived items and citations; replacing a source version does not erase prior provenance history unless the source itself is forgotten.
- Audit events contain actor, scope, subject IDs and transition metadata only. Never copy the forgotten content into logs, analytics, event payloads, or error text.

## 9. Retrieval, provenance and privacy

1. Authorize requested scopes before vector, keyword, graph, or recency search; relevance can never widen permission.
2. Default retrieval is project first, then explicitly permitted user scope. Organization scope is opt-in by workspace policy. Do not merge tenant/org boundaries.
3. Exclude candidate, stale, rejected, archived and forgotten material by default. Return a bounded result set and record IDs, source versions, confidence and scope so the UI can show provenance.
4. Documents are indexed into versioned source/chunk/item records. URLs require HTTPS, SSRF defenses, content-type/size/time bounds, and a sync policy. Extracted API/schema claims preserve endpoint/version/citation metadata.
5. Never train on a user's private data or change foundation-model weights as a side effect. “Learning” changes retrieval records or reviewed skill versions only.

## 10. Frontend integration status

`lib/learning-contract.mjs` validates the record shapes and task/workspace events. `lib/workspace-event-bus.mjs` provides an in-process, bounded pub/sub reference implementation for workspace events; it is not connected to the UI or an HTTP endpoint and does not survive process restarts. The composer has a per-task learning-consent checkbox (off by default); `/api/chat` validates and forwards the boolean to the server-side agent adapter. The execution SSE consumer accepts typed task-learning events and feeds event-backed Memory, Knowledge, Learning, and Skills views in the execution panel. Those views are read-only and reset with the task; they show only records received and validated from the agent stream. A future authenticated `/v1/events` adapter must add scope authorization and durable outbox/replay before production use.

There is no memory/knowledge/learning persistence service, `/v1` API implementation, automatic evaluator, document indexer, sandbox, approval service, forget purge worker, or global workspace-event subscription yet. Until those exist, the UI reports the source as not connected rather than showing fabricated “learned” records. This contract does not change the existing no-persistence boundary for tasks/projects and does not make tool execution live.

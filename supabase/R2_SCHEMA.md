# R2 Supabase schema draft

**Status:** migrations only; parsed and exercised in ephemeral PostgreSQL WASM, but not applied to Supabase or a native PostgreSQL instance. No API routes, Auth gateway, replay endpoint, SSE relay, or end-to-end persistence test is included.

Apply the migrations in filename order:

1. `migrations/202610060001_r2_workspace_core.sql`
2. `migrations/202610060002_r2_workspace_event_store.sql`

The core migration defines Supabase Auth profiles, workspaces/membership, projects, tasks/messages/steps, artifact metadata, approvals, grants, RLS, and integrity triggers. Artifact rows store metadata and a private storage key only; there is no Storage bucket or file-content persistence. There are no Memory/Learning domain tables or runtime features in this phase.

## WorkspaceEvent v1 mapping

`workspace_events` represents the existing R1 **WorkspaceEvent** contract, not the separate agent-platform task-execution SSE contract. The future serializer must emit exactly the R1 envelope fields; normalized database columns are not automatically wire fields.

| R1 v1 envelope field | Database representation | Serialization rule |
| --- | --- | --- |
| `contractVersion` | `contract_version` (`smallint`, constrained to `1`) | Emit the string `"1"`, not the SQL number. |
| `id` | `event_id` (`uuid`) | Emit the UUID as an opaque string. The database generates it. |
| `sequence` | `sequence` (`bigint`) | Emit as a JSON integer; values are capped at JavaScript's safe-integer maximum. The counter is per exact `(scope_type, scope_id)` and survives event retention purges. |
| `occurredAt` | `occurred_at` (`timestamptz`) | Emit an ISO-8601 timestamp normalized to UTC. |
| `scope` | `scope_type`, `scope_id` | Emit `{ "type": scope_type, "id": scope_id }`; both R1 scope identifiers remain strings. |
| `type` | `type` | The SQL allowlist matches R1 `WORKSPACE_EVENT_TYPES`; task-execution event names are not included. |
| `source` | `source` | Emit unchanged. |
| `approvalId` | `approval_id` (`text`, nullable) | Emit unchanged or `null`; it is intentionally not an FK to the different R2 task/tool `approvals` table. |
| `payload` | `payload` (`jsonb`) | Emit the validated JSON object without reshaping it. The future gateway must validate it with the existing R1 contract parser before append. |

The following are database-only: `workspace_id` (tenant/RLS anchor), `actor_id` (audit/authorization attribution), `idempotency_key`, `created_at`, `expires_at`, outbox delivery state, and the generated `task_id`/`status` query projections. In particular, **neither `task_id` nor `status` is added to the v1 envelope**. `task_id` is populated only when `scope.type` is `task`; `status` is derived from an event-specific payload path and may be null. The outbox's own `status` describes relay delivery and is unrelated to an event-envelope status.

R1 scopes are `task`, `project`, `user`, and `organization`; there is no R1 `workspace` scope. In this schema, `workspace_id` is a hidden tenancy anchor, and an R1 `organization` scope is backed one-to-one by that workspace ID. Project/task scope IDs must identify a row in the same workspace. A user-scope ID must be an active workspace member's Auth UUID when written; reads of user-scoped events are restricted to that same authenticated user. All IDs serialize as strings even when their R2 backing identifiers are UUIDs.

R1 `WorkspaceEvent` types include Memory/Learning/Knowledge/Skill event names. This schema only provides the generic event log/outbox for that existing contract; it does **not** create domain tables, retrieval, promotion, or learning behavior. Event payload retention follows the workspace event-retention setting (90 days by default). The runtime must apply the existing privacy/redaction and scope-validation rules before appending payloads.

## Separate execution and approval contracts

The `agent-platform-v1` task-execution envelope is distinct: it has top-level `taskId` and includes `task.*`, `tool.*`, `approval.required`, and `artifact.created` events. Those event types are deliberately not coerced into the WorkspaceEvent table. Durable persistence/replay for that separate stream needs its own explicit schema/serializer decision; do not add `taskId` or `status` to WorkspaceEvent v1.

Likewise, the R2 `public.approvals` table models workspace task/project/artifact/tool-action approvals. The R1 WorkspaceEvent `approval.requested`/`approval.resolved` payload uses the separate R1 approval-record shape. `workspace_events.approval_id` therefore remains an opaque string and has no FK to `public.approvals`; bridging the task/tool approval lifecycle into the event stream is deferred until a compatible event mapping is agreed.

## Authorization and outbox boundaries

- Authenticated users can read event-envelope columns only when the RLS scope rule allows it. Non-user scopes require active workspace membership; user scope is visible only to its subject.
- The workspace creator can read the limited workspace metadata columns needed for `INSERT ... RETURNING`; all child-table and non-user event reads still require active membership.
- Direct event inserts/updates/deletes are not granted. `append_workspace_event()` is executable only by `service_role`; a future server gateway must authenticate the caller, authorize the requested scope, set actor attribution from verified Auth identity, and keep service credentials server-side.
- The append function is idempotent per workspace key, validates membership/approval actor rules, allocates the R1 per-scope sequence transactionally, and inserts the outbox row in the same transaction.
- The outbox is a broadcast/relay queue, not the source of truth. A future worker must claim rows safely, preserve per-scope ordering, retry leases, and only purge source events after retention and successful relay delivery.
- No browser credentials, HTTP endpoint, replay cursor handling, SSE route, worker, or Storage integration is created here.

## Validation status

Both migrations parse with PostgreSQL's SQL parser and execute in an ephemeral PGlite (PostgreSQL WebAssembly) instance using stubbed Supabase Auth roles/schema. Ephemeral behavior checks cover profile/workspace provisioning, RLS/grants, cross-scope rejection, per-scope sequence allocation, idempotency, outbox state, and approval resolution. This is **not** a deployment to Supabase or a substitute for testing its real Auth/PostgREST roles, extensions, and policies; there is no Supabase CLI, `psql`, Docker, or native local Postgres server in this environment.

Before runtime work, apply the migrations to a disposable Supabase/Postgres project and add concurrent-transaction tests for owner preservation, idempotency and per-scope sequencing; test outbox claim/ordering, retention/purge, and round-trip rows through the existing R1 parser. Test the separate task-execution stream on its own contract as well.

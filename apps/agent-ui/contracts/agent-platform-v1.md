# Agent Platform contract — v1 draft

This is the wire contract for task/project records and execution events. The companion [Learning, Memory, Knowledge & Skills contract](./learning-memory-v1.md) extends task SSE with evidence-backed cognitive events and defines the global workspace event stream. These specifications and consumers are accompanied by a **process-local, non-durable Workspace Event Bus reference component**; they do not add task or memory persistence, an orchestrator, real tool execution, file storage, scheduling, connector authentication, an HTTP workspace-event gateway, or approval endpoints. The existing `/api/chat` adapter continues to pass legacy SSE events through unchanged; the UI accepts versioned execution and learning events alongside the legacy format.

## Compatibility and transport

- Every v1 record uses `contractVersion: "1"`.
- IDs are opaque strings; clients must not derive meaning from them.
- Timestamps are ISO-8601 strings with a timezone, normalized to UTC by the client.
- The SSE `event:` name equals the JSON `type`, and `id:` equals the JSON event `id`.
- `sequence` starts at `1` and increases by exactly one for each event in a task stream. Replayed sequences may be ignored by a client; a different `taskId` in the same stream is invalid.
- A v1 stream terminates with `task.completed` or `task.failed`. Legacy `done` and `[DONE]` remain supported for compatibility.
- Tool output must be user-safe, size bounded, and contain operational status only; never include secrets, raw private reasoning, or untrusted HTML.

## Project record

```json
{
  "contractVersion": "1",
  "id": "project_opaque_id",
  "name": "Release work",
  "description": "Release preparation and review",
  "instructions": "Ask before deployment",
  "createdAt": "2026-10-06T12:00:00.000Z",
  "updatedAt": "2026-10-06T12:00:00.000Z"
}
```

## Task record

```json
{
  "contractVersion": "1",
  "id": "task_opaque_id",
  "projectId": "project_opaque_id",
  "title": "Review release",
  "prompt": "Check the release checklist",
  "status": "running",
  "messages": [
    {
      "id": "message_opaque_id",
      "role": "user",
      "content": "Check the release checklist",
      "createdAt": "2026-10-06T12:00:00.000Z"
    }
  ],
  "steps": [
    {
      "id": "inspect",
      "title": "Inspect the project",
      "description": "Review release files",
      "status": "running",
      "toolCallId": "tool_opaque_id",
      "startedAt": "2026-10-06T12:00:01.000Z"
    }
  ],
  "artifacts": [],
  "createdAt": "2026-10-06T12:00:00.000Z",
  "updatedAt": "2026-10-06T12:00:01.000Z"
}
```

Allowed task statuses: `queued`, `planning`, `running`, `waiting_approval`, `completed`, `failed`, `cancelled`. Message roles: `user`, `assistant`, `tool`. Step statuses: `pending`, `running`, `done`, `error`, `blocked`. Artifacts carry metadata only: `id`, `name`, `kind` (`document`, `image`, `code`, `data`, `other`), `createdAt`, and optional `mimeType` and `sizeBytes`. File contents and signed download URLs are deliberately outside this first contract.

## Execution event envelope

Each SSE `data:` line contains one JSON event:

```json
{
  "contractVersion": "1",
  "id": "event_opaque_id",
  "taskId": "task_opaque_id",
  "sequence": 3,
  "occurredAt": "2026-10-06T12:00:03.000Z",
  "type": "tool.progress",
  "payload": {
    "toolCallId": "tool_opaque_id",
    "message": "Waiting for the page response",
    "percent": 40
  }
}
```

The task/tool event vocabulary and minimum payloads are:

| `type` | Payload |
|---|---|
| `task.started` | optional `status`: `planning` or `running` |
| `task.planning` | `steps: Step[]` |
| `tool.started` | `toolCallId`, `toolName`; optional `title`, `description` |
| `tool.progress` | `toolCallId`; optional `message`, `percent` from 0–100 |
| `tool.output` | `toolCallId`; optional user-safe `summary` |
| `approval.required` | `approvalId`, `action`; optional `reason`, `expiresAt` |
| `artifact.created` | `artifact: ArtifactMetadata` |
| `task.completed` | optional `summary`, final `steps` |
| `task.failed` | `error: { code, message, retryable }` |

The v1 stream may also emit the task-scoped `memory.*`, `knowledge.*`, `learning.*`, and `skill.*` events defined in [`learning-memory-v1.md`](./learning-memory-v1.md#6-events). Those events use this same envelope and must precede the terminal task event.

Example stream:

```text
id: event_1
event: task.started
data: {"contractVersion":"1","id":"event_1","taskId":"task_1","sequence":1,"occurredAt":"2026-10-06T12:00:00.000Z","type":"task.started","payload":{"status":"running"}}

id: event_2
event: tool.started
data: {"contractVersion":"1","id":"event_2","taskId":"task_1","sequence":2,"occurredAt":"2026-10-06T12:00:01.000Z","type":"tool.started","payload":{"toolCallId":"tool_1","toolName":"repository.read","title":"Inspect files"}}

id: event_3
event: task.completed
data: {"contractVersion":"1","id":"event_3","taskId":"task_1","sequence":3,"occurredAt":"2026-10-06T12:00:03.000Z","type":"task.completed","payload":{"summary":"Review complete"}}
```

## Current implementation boundary

`lib/agent-contract.mjs` validates task/project records, parses SSE frames, and validates v1 execution plus task-scoped learning events using `lib/learning-contract.mjs`. The chat UI consumes these records and records a bounded operational timeline; artifact and cognitive records are held only for the active task. Invalid events fail the active stream instead of being silently treated as success. Legacy `steps`, `step`, `reply`, `actions`, `done`, and `error` events remain supported.

There is still no `/v1/tasks` persistence API or `/v1/projects` API. The current sample tasks/projects are local UI data, and real artifact download, tool execution, approval decisions, connector authentication, scheduler, and sharing permissions remain unimplemented. Those are separate milestones after the contract is reviewed and agreed with the agent backend.

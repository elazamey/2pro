-- Durable WorkspaceEvent v1 log and transactional outbox.
-- This migration does not create task-execution HTTP/SSE routes or a relay worker.
-- A future server gateway must validate with the R1 contract before calling the
-- append function; no service-role credential belongs in browser code.

create table public.workspace_event_streams (
  scope_type text not null check (scope_type in ('task', 'project', 'user', 'organization')),
  scope_id text not null check (
    scope_id = btrim(scope_id)
    and char_length(scope_id) between 1 and 160
    and scope_id !~ '[[:cntrl:]]'
  ),
  last_sequence bigint not null default 0 check (last_sequence between 0 and 9007199254740991),
  created_at timestamptz not null default clock_timestamp(),
  primary key (scope_type, scope_id)
);

-- Stream counters outlive retained event rows so replay sequence numbers never reset.
create table public.workspace_events (
  event_id uuid primary key default gen_random_uuid(),
  contract_version smallint not null default 1 check (contract_version = 1),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  scope_type text not null check (scope_type in ('task', 'project', 'user', 'organization')),
  scope_id text not null check (
    scope_id = btrim(scope_id)
    and char_length(scope_id) between 1 and 160
    and scope_id !~ '[[:cntrl:]]'
  ),
  -- Storage-only query projection; it is not serialized as a top-level taskId.
  task_id text generated always as (
    case when scope_type = 'task' then scope_id else null end
  ) stored,
  type text not null check (type in (
    'memory.created', 'memory.updated', 'memory.lifecycle_changed', 'memory.forgotten',
    'knowledge.source.ingested', 'knowledge.source.stale', 'knowledge.source.superseded',
    'knowledge.item.extracted', 'knowledge.item.superseded',
    'knowledge.relation.created', 'knowledge.relation.invalidated', 'knowledge.retrieved',
    'learning.experience.recorded', 'learning.evaluation.completed',
    'learning.lesson.candidate', 'learning.lesson.status_changed', 'learning.experiment.completed',
    'skill.candidate', 'skill.status_changed', 'skill.version.created', 'skill.rolled_back',
    'approval.requested', 'approval.resolved'
  )),
  source text not null check (source in ('agent', 'user', 'system', 'connector', 'scheduler', 'service')),
  approval_id text check (
    approval_id is null or (
      approval_id = btrim(approval_id)
      and char_length(approval_id) between 1 and 160
      and approval_id !~ '[[:cntrl:]]'
    )
  ),
  actor_id uuid references auth.users(id) on delete set null,
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 262144
  ),
  -- Internal query projection from event payload; omitted from the v1 envelope.
  status text generated always as (
    case
      when type in ('memory.created', 'memory.updated', 'memory.lifecycle_changed')
        then payload #>> '{memory,lifecycle}'
      when type in ('knowledge.source.ingested', 'knowledge.source.stale', 'knowledge.source.superseded')
        then payload #>> '{source,status}'
      when type in ('knowledge.item.extracted', 'knowledge.item.superseded')
        then payload #>> '{item,lifecycle}'
      when type in ('knowledge.relation.created', 'knowledge.relation.invalidated')
        then payload #>> '{relation,lifecycle}'
      when type in ('learning.lesson.candidate', 'learning.lesson.status_changed')
        then payload #>> '{lesson,lifecycle}'
      when type = 'learning.experiment.completed'
        then payload #>> '{experiment,status}'
      when type in ('skill.candidate', 'skill.status_changed', 'skill.version.created', 'skill.rolled_back')
        then payload #>> '{skill,lifecycle}'
      when type in ('approval.requested', 'approval.resolved')
        then payload #>> '{approval,status}'
      else null
    end
  ) stored,
  sequence bigint not null check (sequence between 1 and 9007199254740991),
  idempotency_key text not null check (
    idempotency_key = btrim(idempotency_key)
    and char_length(idempotency_key) between 1 and 200
    and idempotency_key !~ '[[:cntrl:]]'
  ),
  occurred_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  constraint workspace_events_scope_sequence_unique unique (scope_type, scope_id, sequence),
  constraint workspace_events_workspace_idempotency_unique unique (workspace_id, idempotency_key),
  constraint workspace_events_outbox_identity_unique
    unique (event_id, workspace_id, scope_type, scope_id, sequence),
  constraint workspace_events_task_scope_consistent check (
    (scope_type = 'task' and task_id = scope_id)
    or (scope_type <> 'task' and task_id is null)
  ),
  constraint workspace_events_approval_event_has_approval check (
    type not in ('approval.requested', 'approval.resolved') or approval_id is not null
  ),
  constraint workspace_events_status_projection_length check (
    status is null or (char_length(status) between 1 and 40 and status !~ '[[:cntrl:]]')
  ),
  constraint workspace_events_expiry_after_creation check (expires_at > created_at)
);

create index workspace_events_scope_replay_idx
  on public.workspace_events (scope_type, scope_id, sequence);
create index workspace_events_task_replay_idx
  on public.workspace_events (workspace_id, task_id, sequence)
  where task_id is not null;
create index workspace_events_expiry_idx
  on public.workspace_events (expires_at);
create index workspace_events_status_idx
  on public.workspace_events (workspace_id, type, status, sequence)
  where status is not null;

create table public.event_outbox (
  event_id uuid primary key,
  workspace_id uuid not null,
  scope_type text not null check (scope_type in ('task', 'project', 'user', 'organization')),
  scope_id text not null,
  sequence bigint not null check (sequence between 1 and 9007199254740991),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'delivered', 'dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default clock_timestamp(),
  claimed_by text check (
    claimed_by is null or (
      claimed_by = btrim(claimed_by)
      and char_length(claimed_by) between 1 and 160
      and claimed_by !~ '[[:cntrl:]]'
    )
  ),
  lease_until timestamptz,
  delivered_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 2000),
  created_at timestamptz not null default clock_timestamp(),
  constraint event_outbox_event_identity_fk
    foreign key (event_id, workspace_id, scope_type, scope_id, sequence)
    references public.workspace_events(event_id, workspace_id, scope_type, scope_id, sequence)
    on delete cascade,
  constraint event_outbox_scope_sequence_unique unique (scope_type, scope_id, sequence),
  constraint event_outbox_state_consistent check (
    (status = 'pending' and claimed_by is null and lease_until is null and delivered_at is null)
    or (status = 'processing' and attempts > 0 and claimed_by is not null and lease_until is not null and delivered_at is null)
    or (status = 'delivered' and attempts > 0 and claimed_by is null and lease_until is null and delivered_at is not null and last_error is null)
    or (status = 'dead_letter' and attempts > 0 and claimed_by is null and lease_until is null and delivered_at is null and last_error is not null)
  )
);

create index event_outbox_ready_idx
  on public.event_outbox (available_at, workspace_id, scope_type, scope_id, sequence)
  where status in ('pending', 'processing');
create index event_outbox_expired_lease_idx
  on public.event_outbox (lease_until)
  where status = 'processing';

create or replace function public.validate_workspace_event_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.scope_type = 'organization' then
    if new.scope_id is distinct from new.workspace_id::text then
      raise exception using errcode = '23514', message = 'Organization scope ID must identify its backing workspace.';
    end if;
  elsif new.scope_type = 'project' then
    if not exists (
      select 1 from public.projects p
      where p.id::text = new.scope_id and p.workspace_id = new.workspace_id
    ) then
      raise exception using errcode = '23503', message = 'Project event scope must belong to the workspace.';
    end if;
  elsif new.scope_type = 'task' then
    if not exists (
      select 1 from public.tasks t
      where t.id::text = new.scope_id and t.workspace_id = new.workspace_id
    ) then
      raise exception using errcode = '23503', message = 'Task event scope must belong to the workspace.';
    end if;
  elsif new.scope_type = 'user' then
    if not exists (
      select 1
      from auth.users u
      join public.workspace_members wm on wm.user_id = u.id
      where u.id::text = new.scope_id
        and wm.workspace_id = new.workspace_id
        and wm.status = 'active'
    ) then
      raise exception using errcode = '23503', message = 'User event scope must identify an active workspace member.';
    end if;
  end if;

  if new.type in ('approval.requested', 'approval.resolved') then
    if new.payload #>> '{approval,id}' is distinct from new.approval_id then
      raise exception using errcode = '23514', message = 'Approval payload ID must match the event approval_id.';
    end if;

    if new.type = 'approval.requested'
      and new.payload #>> '{approval,status}' is distinct from 'pending' then
      raise exception using errcode = '23514', message = 'Requested approval events must carry pending approval status.';
    end if;

    if new.type = 'approval.resolved'
      and coalesce(
        new.payload #>> '{approval,status}' not in ('approved', 'rejected', 'expired', 'cancelled'),
        true
      ) then
      raise exception using errcode = '23514', message = 'Resolved approval events must carry a terminal approval status.';
    end if;

    if new.source = 'user' and new.type = 'approval.requested'
      and new.payload #>> '{approval,requestedBy}' is distinct from new.actor_id::text then
      raise exception using errcode = '42501', message = 'Approval requester must match the authenticated actor.';
    end if;

    if new.source = 'user' and new.type = 'approval.resolved' then
      if new.payload #>> '{approval,resolvedBy}' is distinct from new.actor_id::text then
        raise exception using errcode = '42501', message = 'Approval resolver must match the authenticated actor.';
      end if;
      if new.payload #>> '{approval,requestedBy}' = new.actor_id::text then
        raise exception using errcode = '42501', message = 'The requester cannot resolve their own approval.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger workspace_events_validate_scope
  before insert on public.workspace_events
  for each row execute function public.validate_workspace_event_scope();

create or replace function public.create_workspace_event_outbox_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.event_outbox (event_id, workspace_id, scope_type, scope_id, sequence)
  values (new.event_id, new.workspace_id, new.scope_type, new.scope_id, new.sequence);
  return new;
end;
$$;

create trigger workspace_events_enqueue_outbox
  after insert on public.workspace_events
  for each row execute function public.create_workspace_event_outbox_entry();

create or replace function public.prevent_workspace_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception using errcode = '23514', message = 'Workspace events are append-only.';
  end if;

  if old.expires_at > clock_timestamp() then
    raise exception using errcode = '23514', message = 'Workspace event retention period has not elapsed.';
  end if;

  if exists (
    select 1 from public.event_outbox o
    where o.event_id = old.event_id and o.status <> 'delivered'
  ) then
    raise exception using errcode = '23514', message = 'Undelivered outbox events cannot be purged.';
  end if;

  return old;
end;
$$;

create trigger workspace_events_append_only
  before update or delete on public.workspace_events
  for each row execute function public.prevent_workspace_event_mutation();

create or replace function public.append_workspace_event(
  p_workspace_id uuid,
  p_scope_type text,
  p_scope_id text,
  p_type text,
  p_source text,
  p_approval_id text,
  p_actor_id uuid,
  p_payload jsonb,
  p_occurred_at timestamptz,
  p_idempotency_key text
)
returns public.workspace_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace public.workspaces%rowtype;
  v_existing public.workspace_events%rowtype;
  v_event public.workspace_events%rowtype;
  v_actor_role text;
  v_last_sequence bigint;
  v_sequence bigint;
begin
  if p_workspace_id is null then
    raise exception using errcode = '22023', message = 'Workspace ID is required.';
  end if;

  if p_idempotency_key is null
    or p_idempotency_key <> btrim(p_idempotency_key)
    or char_length(p_idempotency_key) not between 1 and 200
    or p_idempotency_key ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Idempotency key is invalid.';
  end if;

  -- Serialize only retries using the same workspace key. The shared row lock
  -- prevents appending across a concurrent archive without serializing every
  -- independent event in the workspace.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_idempotency_key, 0)
  );

  select * into v_workspace
  from public.workspaces w
  where w.id = p_workspace_id and w.archived_at is null
  for share;

  if not found then
    raise exception using errcode = '23503', message = 'Workspace does not exist or is archived.';
  end if;

  if p_actor_id is not null then
    v_actor_role := public.workspace_role_for(p_workspace_id, p_actor_id);
    if v_actor_role is null or v_actor_role not in ('owner', 'admin', 'member') then
      raise exception using errcode = '42501', message = 'Actor is not authorized to append workspace events.';
    end if;
  elsif p_source = 'user' then
    raise exception using errcode = '42501', message = 'User-originated events require an authenticated actor ID.';
  end if;

  if p_type = 'approval.resolved' and p_actor_id is not null
    and v_actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'Only a workspace owner or admin can resolve approvals.';
  end if;

  select * into v_existing
  from public.workspace_events e
  where e.workspace_id = p_workspace_id and e.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.scope_type is distinct from p_scope_type
      or v_existing.scope_id is distinct from p_scope_id
      or v_existing.type is distinct from p_type
      or v_existing.source is distinct from p_source
      or v_existing.approval_id is distinct from p_approval_id
      or v_existing.actor_id is distinct from p_actor_id
      or v_existing.payload is distinct from p_payload
      or v_existing.occurred_at is distinct from p_occurred_at then
      raise exception using errcode = '23505', message = 'Idempotency key was already used for a different event.';
    end if;
    return v_existing;
  end if;

  insert into public.workspace_event_streams (scope_type, scope_id)
  values (p_scope_type, p_scope_id)
  on conflict (scope_type, scope_id) do nothing;

  select s.last_sequence into v_last_sequence
  from public.workspace_event_streams s
  where s.scope_type = p_scope_type and s.scope_id = p_scope_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'Workspace event stream could not be initialized.';
  end if;

  if v_last_sequence >= 9007199254740991 then
    raise exception using errcode = '22003', message = 'Workspace event sequence exceeded the v1 safe integer range.';
  end if;

  update public.workspace_event_streams s
  set last_sequence = s.last_sequence + 1
  where s.scope_type = p_scope_type and s.scope_id = p_scope_id
  returning s.last_sequence into v_sequence;

  insert into public.workspace_events (
    workspace_id, scope_type, scope_id, type, source, approval_id, actor_id,
    payload, sequence, idempotency_key, occurred_at, expires_at
  ) values (
    p_workspace_id, p_scope_type, p_scope_id, p_type, p_source, p_approval_id, p_actor_id,
    p_payload, v_sequence, p_idempotency_key, p_occurred_at,
    clock_timestamp() + make_interval(days => v_workspace.event_retention_days)
  ) returning * into v_event;

  return v_event;
end;
$$;

alter table public.workspace_event_streams enable row level security;
alter table public.workspace_events enable row level security;
alter table public.event_outbox enable row level security;

create policy workspace_events_select_authorized_scope on public.workspace_events
  for select to authenticated using (
    case
      when scope_type = 'user' then scope_id = ((select auth.uid())::text)
      else public.is_workspace_member(workspace_id)
    end
  );

revoke all on function public.validate_workspace_event_scope() from public, anon, authenticated, service_role;
revoke all on function public.create_workspace_event_outbox_entry() from public, anon, authenticated, service_role;
revoke all on function public.prevent_workspace_event_mutation() from public, anon, authenticated, service_role;
revoke all on function public.append_workspace_event(uuid, text, text, text, text, text, uuid, jsonb, timestamptz, text)
  from public, anon, authenticated, service_role;

revoke all on public.workspace_event_streams, public.workspace_events, public.event_outbox
  from anon, authenticated, service_role;
grant select (
  event_id, contract_version, scope_type, scope_id, type, source,
  approval_id, payload, sequence, occurred_at
) on public.workspace_events to authenticated;
grant select on public.workspace_events to service_role;
grant select on public.event_outbox to service_role;
grant update (status, attempts, available_at, claimed_by, lease_until, delivered_at, last_error)
  on public.event_outbox to service_role;
grant execute on function public.append_workspace_event(uuid, text, text, text, text, text, uuid, jsonb, timestamptz, text)
  to service_role;

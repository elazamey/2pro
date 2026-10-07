-- R2 schema only: Supabase Auth-backed workspace, project, task, artifact,
-- and approval records. No application runtime is connected by this migration.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint profiles_display_name_length check (
    display_name is null or char_length(btrim(display_name)) between 1 and 80
  )
);

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), 80), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_auth_user_profile();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  event_retention_days integer not null default 90,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  constraint workspaces_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint workspaces_event_retention_days_bound check (event_retention_days between 7 and 3650)
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_active_idx
  on public.workspace_members (user_id, workspace_id)
  where status = 'active';

create or replace function public.workspace_role_for(p_workspace_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select wm.role
  from public.workspace_members as wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = p_user_id
    and wm.status = 'active'
  limit 1;
$$;

create or replace function public.is_workspace_member_for(p_workspace_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members as wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_user_id
      and wm.status = 'active'
  );
$$;

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member_for(p_workspace_id, (select auth.uid()));
$$;

create or replace function public.has_workspace_role(p_workspace_id uuid, p_allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.workspace_role_for(p_workspace_id, (select auth.uid())) = any(p_allowed_roles),
    false
  );
$$;

create or replace function public.provision_workspace_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is null then
    raise exception using errcode = '23514', message = 'A workspace must have an authenticated creator.';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, status, created_by)
  values (new.id, new.created_by, 'owner', 'active', new.created_by);

  return new;
end;
$$;

create trigger workspaces_provision_owner
  after insert on public.workspaces
  for each row execute function public.provision_workspace_owner();

create or replace function public.prevent_last_workspace_owner_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serialize ownership changes for this workspace so concurrent updates cannot
  -- each observe the other's active owner and remove the last one.
  perform 1
  from public.workspaces as w
  where w.id = old.workspace_id
  for update;

  if not found then
    if tg_op = 'DELETE' then
      -- Permit ON DELETE CASCADE when the parent workspace itself is removed.
      return old;
    end if;
    raise exception using errcode = '23503', message = 'Workspace must exist while membership changes.';
  end if;

  if tg_op = 'DELETE' then
    if old.role = 'owner' and old.status = 'active' and not exists (
      select 1
      from public.workspace_members as other_owner
      where other_owner.workspace_id = old.workspace_id
        and other_owner.user_id <> old.user_id
        and other_owner.role = 'owner'
        and other_owner.status = 'active'
    ) then
      raise exception using errcode = '23514', message = 'A workspace must retain at least one active owner.';
    end if;
    return old;
  end if;

  if new.workspace_id is distinct from old.workspace_id
    or new.user_id is distinct from old.user_id then
    raise exception using errcode = '23514', message = 'Workspace membership identity is immutable.';
  end if;

  if old.role = 'owner' and old.status = 'active'
    and (new.role <> 'owner' or new.status <> 'active')
    and not exists (
      select 1
      from public.workspace_members as other_owner
      where other_owner.workspace_id = old.workspace_id
        and other_owner.user_id <> old.user_id
        and other_owner.role = 'owner'
        and other_owner.status = 'active'
    ) then
    raise exception using errcode = '23514', message = 'A workspace must retain at least one active owner.';
  end if;

  return new;
end;
$$;

create trigger workspace_members_preserve_owner
  before update or delete on public.workspace_members
  for each row execute function public.prevent_last_workspace_owner_removal();

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  description text not null default '',
  instructions text not null default '',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  constraint projects_name_length check (char_length(btrim(name)) between 1 and 160),
  constraint projects_description_length check (char_length(description) <= 2000),
  constraint projects_instructions_length check (char_length(instructions) <= 2000),
  constraint projects_id_workspace_unique unique (id, workspace_id)
);

create index projects_workspace_updated_idx
  on public.projects (workspace_id, updated_at desc)
  where archived_at is null;

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  project_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  prompt text not null default '',
  status text not null default 'queued'
    check (status in ('queued', 'planning', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled')),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  constraint tasks_title_length check (char_length(btrim(title)) between 1 and 160),
  constraint tasks_prompt_length check (char_length(prompt) <= 8000),
  constraint tasks_id_workspace_unique unique (id, workspace_id),
  constraint tasks_project_same_workspace_fk
    foreign key (project_id, workspace_id)
    references public.projects(id, workspace_id)
    on delete restrict
);

create index tasks_workspace_updated_idx
  on public.tasks (workspace_id, updated_at desc)
  where archived_at is null;
create index tasks_project_updated_idx
  on public.tasks (project_id, updated_at desc)
  where project_id is not null and archived_at is null;

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

create table public.task_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id uuid not null,
  sequence bigint not null check (sequence > 0),
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null check (char_length(content) <= 8000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  constraint task_messages_user_author check (role <> 'user' or created_by is not null),
  constraint task_messages_task_sequence_unique unique (task_id, sequence),
  constraint task_messages_id_workspace_unique unique (id, workspace_id),
  constraint task_messages_task_same_workspace_fk
    foreign key (task_id, workspace_id)
    references public.tasks(id, workspace_id)
    on delete cascade
);

create index task_messages_task_sequence_idx
  on public.task_messages (task_id, sequence);

create or replace function public.validate_task_message_sequence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next_sequence bigint;
begin
  perform 1
  from public.tasks as t
  where t.id = new.task_id and t.workspace_id = new.workspace_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'Task message parent must belong to the same workspace.';
  end if;

  select coalesce(max(m.sequence), 0) + 1 into v_next_sequence
  from public.task_messages as m
  where m.task_id = new.task_id;

  if new.sequence <> v_next_sequence then
    raise exception using errcode = '23514', message = 'Task message sequence must be contiguous and ordered.';
  end if;

  return new;
end;
$$;

create trigger task_messages_validate_sequence
  before insert on public.task_messages
  for each row execute function public.validate_task_message_sequence();

create table public.task_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id uuid not null,
  step_id text not null check (char_length(btrim(step_id)) between 1 and 160),
  position integer not null check (position >= 0),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'error', 'blocked')),
  tool_call_id text check (tool_call_id is null or char_length(tool_call_id) <= 160),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint task_steps_task_step_unique unique (task_id, step_id),
  constraint task_steps_task_position_unique unique (task_id, position),
  constraint task_steps_task_same_workspace_fk
    foreign key (task_id, workspace_id)
    references public.tasks(id, workspace_id)
    on delete cascade,
  constraint task_steps_time_order check (finished_at is null or started_at is null or finished_at >= started_at)
);

create index task_steps_task_position_idx on public.task_steps (task_id, position);
create trigger task_steps_set_updated_at
  before update on public.task_steps
  for each row execute function public.set_updated_at();

-- Artifact rows hold metadata and a private storage key only. This migration
-- does not create a Storage bucket or store binary file contents.
create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  task_id uuid,
  project_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 240),
  kind text not null check (kind in ('document', 'image', 'code', 'data', 'other')),
  mime_type text check (mime_type is null or char_length(mime_type) <= 160),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text check (
    storage_key is null
    or (char_length(storage_key) <= 1024 and storage_key !~ '^[a-zA-Z][a-zA-Z0-9+.-]*://')
  ),
  status text not null default 'registered' check (status in ('registered', 'available', 'unavailable', 'deleted')),
  created_at timestamptz not null default clock_timestamp(),

  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  constraint artifacts_id_workspace_unique unique (id, workspace_id),
  constraint artifacts_available_requires_storage_key check (status <> 'available' or storage_key is not null),
  constraint artifacts_deleted_state_consistent check ((status = 'deleted') = (deleted_at is not null)),
  constraint artifacts_task_same_workspace_fk
    foreign key (task_id, workspace_id)
    references public.tasks(id, workspace_id)
    on delete restrict,
  constraint artifacts_project_same_workspace_fk
    foreign key (project_id, workspace_id)
    references public.projects(id, workspace_id)
    on delete restrict
);

create index artifacts_workspace_created_idx
  on public.artifacts (workspace_id, created_at desc)
  where deleted_at is null;
create index artifacts_task_created_idx
  on public.artifacts (task_id, created_at desc)
  where task_id is not null and deleted_at is null;

create or replace function public.validate_artifact_parent_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_project_id uuid;
begin
  if new.task_id is null then
    return new;
  end if;

  select t.project_id into v_task_project_id
  from public.tasks as t
  where t.id = new.task_id and t.workspace_id = new.workspace_id;

  if not found then
    raise exception using errcode = '23503', message = 'Artifact task must belong to the same workspace.';
  end if;

  if new.project_id is null then
    new.project_id := v_task_project_id;
  elsif new.project_id is distinct from v_task_project_id then
    raise exception using errcode = '23514', message = 'Artifact project must match its task project.';
  end if;

  return new;
end;
$$;

create trigger artifacts_validate_parent_scope
  before insert or update of workspace_id, task_id, project_id on public.artifacts
  for each row execute function public.validate_artifact_parent_scope();

create trigger artifacts_set_updated_at
  before update on public.artifacts
  for each row execute function public.set_updated_at();

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  task_id uuid,
  subject_kind text not null check (subject_kind in ('task', 'project', 'artifact', 'tool_action')),
  subject_id uuid not null,
  requested_action text not null check (requested_action in (
    'execute_tool', 'write_file', 'send_message', 'deploy', 'delete_resource', 'share_scope', 'other'
  )),
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  reason text not null default '' check (char_length(reason) <= 2000),
  idempotency_key text not null check (
    idempotency_key = btrim(idempotency_key)
    and char_length(idempotency_key) between 1 and 200
    and idempotency_key !~ '[[:cntrl:]]'
  ),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  constraint approvals_id_workspace_unique unique (id, workspace_id),
  constraint approvals_request_idempotency_unique unique (workspace_id, requested_by, idempotency_key),
  constraint approvals_task_same_workspace_fk
    foreign key (task_id, workspace_id)
    references public.tasks(id, workspace_id)
    on delete restrict,
  constraint approvals_resolution_state check (
    (status = 'pending' and resolved_at is null and resolved_by is null)
    or (status in ('approved', 'rejected') and resolved_at is not null and resolved_by is not null and resolved_by <> requested_by)
    or (status in ('expired', 'cancelled') and resolved_at is not null)
  ),
  constraint approvals_expiry_after_creation check (expires_at is null or expires_at > created_at),
  constraint approvals_resolution_after_creation check (resolved_at is null or resolved_at >= created_at)
);

create index approvals_workspace_status_created_idx
  on public.approvals (workspace_id, status, created_at desc);
create index approvals_task_created_idx
  on public.approvals (task_id, created_at desc)
  where task_id is not null;

create or replace function public.validate_approval_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status <> 'pending' then
      raise exception using errcode = '23514', message = 'Only pending approvals can be resolved.';
    end if;
    if new.status not in ('approved', 'rejected', 'expired', 'cancelled') then
      raise exception using errcode = '23514', message = 'An approval must transition from pending to a terminal status.';
    end if;
    if new.status in ('approved', 'rejected') and new.resolved_by = old.requested_by then
      raise exception using errcode = '42501', message = 'The requester cannot approve or reject their own request.';
    end if;
  elsif tg_op = 'INSERT' and new.status <> 'pending' then
    raise exception using errcode = '23514', message = 'New approvals must start pending.';
  end if;
  return new;
end;
$$;

create trigger approvals_validate_transition
  before insert or update on public.approvals
  for each row execute function public.validate_approval_transition();

create or replace function public.validate_approval_subject()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artifact_task_id uuid;
begin
  if new.subject_kind = 'task' then
    if new.task_id is distinct from new.subject_id
      or not exists (
        select 1 from public.tasks t
        where t.id = new.subject_id and t.workspace_id = new.workspace_id
      ) then
      raise exception using errcode = '23503', message = 'Approval task subject and task_id must match within the same workspace.';
    end if;
  elsif new.subject_kind = 'project' then
    if not exists (
      select 1 from public.projects p
      where p.id = new.subject_id and p.workspace_id = new.workspace_id
    ) then
      raise exception using errcode = '23503', message = 'Approval project subject must belong to the same workspace.';
    end if;
    if new.task_id is not null and not exists (
      select 1 from public.tasks t
      where t.id = new.task_id
        and t.workspace_id = new.workspace_id
        and t.project_id = new.subject_id
    ) then
      raise exception using errcode = '23514', message = 'Approval task must belong to its project subject.';
    end if;
  elsif new.subject_kind = 'artifact' then
    select a.task_id into v_artifact_task_id
    from public.artifacts a
    where a.id = new.subject_id and a.workspace_id = new.workspace_id;
    if not found then
      raise exception using errcode = '23503', message = 'Approval artifact subject must belong to the same workspace.';
    end if;
    if new.task_id is distinct from v_artifact_task_id then
      raise exception using errcode = '23514', message = 'Approval task must match its artifact subject.';
    end if;
  end if;

  return new;
end;
$$;

create trigger approvals_validate_subject
  before insert or update of workspace_id, task_id, subject_kind, subject_id on public.approvals
  for each row execute function public.validate_approval_subject();

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_messages enable row level security;
alter table public.task_steps enable row level security;
alter table public.artifacts enable row level security;
alter table public.approvals enable row level security;

create policy profiles_select_self on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy workspaces_select_member on public.workspaces
  for select to authenticated using (
    public.is_workspace_member(id)
    or created_by = (select auth.uid())
  );
create policy workspaces_insert_self on public.workspaces
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy workspaces_update_admin on public.workspaces
  for update to authenticated
  using (public.has_workspace_role(id, array['owner', 'admin']::text[]))
  with check (public.has_workspace_role(id, array['owner', 'admin']::text[]));

create policy workspace_members_select_member on public.workspace_members
  for select to authenticated using (public.is_workspace_member(workspace_id));

create policy projects_select_member on public.projects
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy projects_insert_editor on public.projects
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and public.has_workspace_role(workspace_id, array['owner', 'admin', 'member']::text[])
  );
create policy projects_update_editor on public.projects
  for update to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'member']::text[]))
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'member']::text[]));

create policy tasks_select_member on public.tasks
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy tasks_insert_editor on public.tasks
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and public.has_workspace_role(workspace_id, array['owner', 'admin', 'member']::text[])
  );
create policy tasks_update_editor on public.tasks
  for update to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'member']::text[]))
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'member']::text[]));

create policy task_messages_select_member on public.task_messages
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy task_messages_insert_user_message on public.task_messages
  for insert to authenticated with check (
    role = 'user'
    and created_by = (select auth.uid())
    and public.has_workspace_role(workspace_id, array['owner', 'admin', 'member']::text[])
  );

create policy task_steps_select_member on public.task_steps
  for select to authenticated using (public.is_workspace_member(workspace_id));

create policy artifacts_select_member on public.artifacts
  for select to authenticated using (public.is_workspace_member(workspace_id));

create policy approvals_select_member on public.approvals
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy approvals_insert_requester on public.approvals
  for insert to authenticated with check (
    requested_by = (select auth.uid())
    and status = 'pending'
    and resolved_at is null
    and resolved_by is null
    and public.has_workspace_role(workspace_id, array['owner', 'admin', 'member']::text[])
  );
create policy approvals_resolve_by_other_admin on public.approvals
  for update to authenticated
  using (
    status = 'pending'
    and requested_by <> (select auth.uid())
    and public.has_workspace_role(workspace_id, array['owner', 'admin']::text[])
  )
  with check (
    status in ('approved', 'rejected')
    and resolved_at is not null
    and resolved_by = (select auth.uid())
    and requested_by <> (select auth.uid())
    and public.has_workspace_role(workspace_id, array['owner', 'admin']::text[])
  );

revoke all on function public.set_updated_at() from public, anon, authenticated, service_role;
revoke all on function public.handle_new_auth_user_profile() from public, anon, authenticated, service_role;
revoke all on function public.workspace_role_for(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.is_workspace_member_for(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.is_workspace_member(uuid) from public, anon, authenticated, service_role;
revoke all on function public.has_workspace_role(uuid, text[]) from public, anon, authenticated, service_role;
revoke all on function public.provision_workspace_owner() from public, anon, authenticated, service_role;
revoke all on function public.prevent_last_workspace_owner_removal() from public, anon, authenticated, service_role;
revoke all on function public.validate_task_message_sequence() from public, anon, authenticated, service_role;
revoke all on function public.validate_artifact_parent_scope() from public, anon, authenticated, service_role;
revoke all on function public.validate_approval_transition() from public, anon, authenticated, service_role;
revoke all on function public.validate_approval_subject() from public, anon, authenticated, service_role;

revoke all on public.profiles, public.workspaces, public.workspace_members, public.projects,
  public.tasks, public.task_messages, public.task_steps, public.artifacts, public.approvals
  from anon, authenticated, service_role;

grant select on public.profiles to authenticated;
grant insert (id, display_name) on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select (id, name, created_at, updated_at, archived_at) on public.workspaces to authenticated;
grant insert (name, created_by) on public.workspaces to authenticated;
grant update (name) on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
grant select on public.projects to authenticated;
grant insert (workspace_id, created_by, name, description, instructions) on public.projects to authenticated;
grant update (name, description, instructions) on public.projects to authenticated;
grant select on public.tasks to authenticated;
grant insert (workspace_id, project_id, created_by, title, prompt) on public.tasks to authenticated;
grant update (project_id, title, prompt) on public.tasks to authenticated;
grant select on public.task_messages to authenticated;
grant insert (workspace_id, task_id, sequence, role, content, created_by) on public.task_messages to authenticated;
grant select on public.task_steps, public.artifacts, public.approvals to authenticated;
grant insert (workspace_id, task_id, subject_kind, subject_id, requested_action, requested_by, reason, idempotency_key, expires_at) on public.approvals to authenticated;
grant update (status, reason, resolved_at, resolved_by) on public.approvals to authenticated;

grant select, insert, update on public.profiles to service_role;
grant select on public.workspaces to service_role;
grant insert (name, created_by) on public.workspaces to service_role;
grant update (name, event_retention_days, archived_at) on public.workspaces to service_role;
grant select, insert, update, delete on public.workspace_members to service_role;
grant select, insert, update, delete on public.projects to service_role;
grant select, insert, update, delete on public.tasks to service_role;
grant select, insert on public.task_messages to service_role;
grant select, insert, update, delete on public.task_steps to service_role;
grant select, insert, update, delete on public.artifacts to service_role;
grant select, insert, update on public.approvals to service_role;

grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.has_workspace_role(uuid, text[]) to authenticated, service_role;
grant usage on schema public to authenticated, service_role;

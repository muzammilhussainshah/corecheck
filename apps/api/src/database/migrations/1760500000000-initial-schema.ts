import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Milestone 1 schema: tenancy, users, roles, organisation structure, sessions,
 * audit history and the offline-sync proof of concept.
 *
 * Isolation is enforced in the database, not only in the API:
 *
 * - Every customer table carries org_id, and child rows reference their parent
 *   through (id, org_id) composite keys, so a row can never point at another
 *   organisation's data.
 * - Customer requests run as the corecheck_app role with row-level security:
 *   each policy admits only rows whose org_id matches the request's
 *   organisation (corecheck.org_id, set per transaction by the API).
 * - Internal staff requests run as corecheck_platform, which is granted the
 *   platform tables and nothing else: staff code cannot read customer records
 *   even by mistake (IAD-011).
 * - The table owner (the role migrations run as) bypasses row-level security.
 *   The API uses it only for sign-in, session checks and provisioning.
 */
export class InitialSchema1760500000000 implements MigrationInterface {
  name = 'InitialSchema1760500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(SCHEMA_UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(SCHEMA_DOWN);
  }
}

const SCHEMA_UP = /* sql */ `
create schema corecheck;

-- ------------------------------------------------------------ database roles

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'corecheck_app') then
    create role corecheck_app nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'corecheck_platform') then
    create role corecheck_platform nologin;
  end if;
end
$$;

-- The connecting role switches into these per transaction.
grant corecheck_app to current_user;
grant corecheck_platform to current_user;
grant usage on schema corecheck to corecheck_app, corecheck_platform;

-- ------------------------------------------------------- request context

create function corecheck.current_org_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('corecheck.org_id', true), '')::uuid $$;

create function corecheck.current_user_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('corecheck.user_id', true), '')::uuid $$;

create function corecheck.set_updated_at() returns trigger
  language plpgsql
  as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- ------------------------------------------------------------ organisations

create table corecheck.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  industry text not null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text not null,
  address text not null,
  country text not null,
  time_zone text not null,
  seat_limit integer not null check (seat_limit > 0),
  starts_on date not null,
  expires_on date not null,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organisations_dates_check check (expires_on >= starts_on)
);
create unique index organisations_name_key on corecheck.organisations (lower(name));
create trigger organisations_updated_at before update on corecheck.organisations
  for each row execute function corecheck.set_updated_at();

-- -------------------------------------------------------------------- roles

create table corecheck.roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references corecheck.organisations (id),
  standard_key text
    check (standard_key in ('operative', 'technician', 'supervisor', 'manager', 'admin')),
  name text not null check (length(name) between 1 and 60),
  description text not null default '',
  org_wide_scope boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_id_org_key unique (id, org_id),
  constraint roles_standard_key unique (org_id, standard_key)
);
create unique index roles_org_name_key on corecheck.roles (org_id, lower(name));
create trigger roles_updated_at before update on corecheck.roles
  for each row execute function corecheck.set_updated_at();

create table corecheck.role_permissions (
  org_id uuid not null,
  role_id uuid not null,
  permission text not null,
  primary key (role_id, permission),
  foreign key (role_id, org_id) references corecheck.roles (id, org_id) on delete cascade
);

-- -------------------------------------------------------------------- users

create table corecheck.users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references corecheck.organisations (id),
  first_name text not null,
  last_name text not null,
  -- Lower case and unique across the whole platform (USR-AC-01).
  username text not null check (username = lower(username)),
  email text,
  role_id uuid not null,
  status text not null default 'active' check (status in ('active', 'inactive', 'locked')),
  pin_hash text not null,
  must_change_pin boolean not null default true,
  temp_pin_expires_at timestamptz,
  failed_pin_attempts integer not null default 0,
  locked_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_id_org_key unique (id, org_id),
  foreign key (role_id, org_id) references corecheck.roles (id, org_id)
);
create unique index users_username_key on corecheck.users (username);
create index users_org_idx on corecheck.users (org_id);
create trigger users_updated_at before update on corecheck.users
  for each row execute function corecheck.set_updated_at();

-- Seat limit (IAD-005, IAD-AC-02). Enforced here so that no code path can
-- activate a user beyond the contracted number of seats. Active and Locked
-- users hold a seat; Inactive users do not. The advisory lock serialises
-- concurrent activations within one organisation.
create function corecheck.enforce_seat_limit() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_limit integer;
  v_used integer;
begin
  if new.status not in ('active', 'locked') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status in ('active', 'locked') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('corecheck.seats:' || new.org_id::text, 0));

  select seat_limit into v_limit from corecheck.organisations where id = new.org_id;
  select count(*) into v_used
    from corecheck.users
   where org_id = new.org_id
     and status in ('active', 'locked')
     and id <> new.id;

  if v_used >= v_limit then
    raise exception using
      errcode = 'CC001',
      message = 'SEAT_LIMIT_REACHED',
      detail = format('All %s seats are in use.', v_limit);
  end if;
  return new;
end
$$;
revoke all on function corecheck.enforce_seat_limit() from public;

create trigger users_seat_limit before insert or update of status on corecheck.users
  for each row execute function corecheck.enforce_seat_limit();

-- Usernames are unique across organisations, but row-level security hides
-- other organisations' users. This answers "is it taken?" and nothing more.
create function corecheck.username_taken(candidate text) returns boolean
  language sql stable
  security definer
  set search_path = ''
  as $$ select exists (select 1 from corecheck.users where username = lower(candidate)) $$;
revoke all on function corecheck.username_taken(text) from public;

-- ------------------------------------------------------------------ sessions

create table corecheck.user_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  token_hash text not null,
  client text not null check (client in ('web', 'mobile')),
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  idle_timeout_seconds integer not null,
  revoked_at timestamptz,
  revoke_reason text,
  foreign key (user_id, org_id) references corecheck.users (id, org_id)
);
create unique index user_sessions_token_key on corecheck.user_sessions (token_hash);
-- At most one live session per user (USR-006, USR-AC-03).
create unique index user_sessions_one_live on corecheck.user_sessions (user_id)
  where revoked_at is null;

-- ---------------------------------------------------- organisation structure

create table corecheck.sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references corecheck.organisations (id),
  name text not null,
  code text,
  address text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sites_id_org_key unique (id, org_id)
);
create unique index sites_org_name_key on corecheck.sites (org_id, lower(name));
create trigger sites_updated_at before update on corecheck.sites
  for each row execute function corecheck.set_updated_at();

create table corecheck.site_areas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  site_id uuid not null,
  name text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_areas_id_org_key unique (id, org_id),
  foreign key (site_id, org_id) references corecheck.sites (id, org_id)
);
create unique index site_areas_site_name_key on corecheck.site_areas (site_id, lower(name));
create trigger site_areas_updated_at before update on corecheck.site_areas
  for each row execute function corecheck.set_updated_at();

create table corecheck.teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references corecheck.organisations (id),
  name text not null,
  description text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_id_org_key unique (id, org_id)
);
create unique index teams_org_name_key on corecheck.teams (org_id, lower(name));
create trigger teams_updated_at before update on corecheck.teams
  for each row execute function corecheck.set_updated_at();

create table corecheck.disciplines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references corecheck.organisations (id),
  name text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint disciplines_id_org_key unique (id, org_id)
);
create unique index disciplines_org_name_key on corecheck.disciplines (org_id, lower(name));
create trigger disciplines_updated_at before update on corecheck.disciplines
  for each row execute function corecheck.set_updated_at();

create table corecheck.user_sites (
  org_id uuid not null,
  user_id uuid not null,
  site_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, site_id),
  foreign key (user_id, org_id) references corecheck.users (id, org_id),
  foreign key (site_id, org_id) references corecheck.sites (id, org_id)
);
create index user_sites_site_idx on corecheck.user_sites (site_id);

create table corecheck.user_teams (
  org_id uuid not null,
  user_id uuid not null,
  team_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, team_id),
  foreign key (user_id, org_id) references corecheck.users (id, org_id),
  foreign key (team_id, org_id) references corecheck.teams (id, org_id)
);
create index user_teams_team_idx on corecheck.user_teams (team_id);

create table corecheck.user_disciplines (
  org_id uuid not null,
  user_id uuid not null,
  discipline_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, discipline_id),
  foreign key (user_id, org_id) references corecheck.users (id, org_id),
  foreign key (discipline_id, org_id) references corecheck.disciplines (id, org_id)
);
create index user_disciplines_discipline_idx on corecheck.user_disciplines (discipline_id);

-- --------------------------------------------------------- internal staff

create table corecheck.platform_staff (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  name text not null,
  staff_role text not null check (staff_role in ('owner', 'admin', 'support')),
  password_hash text not null,
  must_change_password boolean not null default true,
  mfa_secret_encrypted text,
  mfa_pending_secret_encrypted text,
  mfa_enabled_at timestamptz,
  status text not null default 'active' check (status in ('active', 'disabled')),
  failed_login_attempts integer not null default 0,
  locked_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index platform_staff_email_key on corecheck.platform_staff (email);
create trigger platform_staff_updated_at before update on corecheck.platform_staff
  for each row execute function corecheck.set_updated_at();

create table corecheck.staff_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references corecheck.platform_staff (id),
  token_hash text not null,
  mfa_verified_at timestamptz,
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  idle_timeout_seconds integer not null,
  revoked_at timestamptz,
  revoke_reason text
);
create unique index staff_sessions_token_key on corecheck.staff_sessions (token_hash);

-- ------------------------------------------------------------- audit history

create table corecheck.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  -- tenant: visible to the organisation. platform: internal provisioning and
  -- staff security records, visible to CoreCheck staff only.
  scope text not null check (scope in ('tenant', 'platform')),
  org_id uuid references corecheck.organisations (id),
  actor_type text not null check (actor_type in ('user', 'staff', 'system')),
  actor_id uuid,
  actor_name text,
  action text not null,
  entity_type text,
  entity_id text,
  summary text not null,
  before jsonb,
  after jsonb,
  metadata jsonb not null default '{}'::jsonb,
  constraint audit_events_tenant_has_org check (scope = 'platform' or org_id is not null)
);
create index audit_events_org_time_idx on corecheck.audit_events (org_id, occurred_at desc);
create index audit_events_scope_time_idx on corecheck.audit_events (scope, occurred_at desc);

-- Audit entries cannot be changed or removed by anyone, the table owner
-- included (AUD-004, AUD-AC-03).
create function corecheck.reject_audit_change() returns trigger
  language plpgsql
  as $$
begin
  raise exception using
    errcode = 'CC002',
    message = 'AUDIT_IMMUTABLE',
    detail = 'Audit history cannot be modified or deleted.';
end
$$;
create trigger audit_events_immutable before update or delete on corecheck.audit_events
  for each row execute function corecheck.reject_audit_change();
create trigger audit_events_no_truncate before truncate on corecheck.audit_events
  for each statement execute function corecheck.reject_audit_change();

-- ------------------------------------------- offline sync proof of concept

create table corecheck.poc_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references corecheck.organisations (id),
  site_id uuid not null,
  title text not null,
  plant_label text not null,
  status text not null default 'open' check (status in ('open', 'submitted')),
  submitted_by uuid,
  submitted_at timestamptz,
  submitted_on_device_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint poc_checks_id_org_key unique (id, org_id),
  foreign key (site_id, org_id) references corecheck.sites (id, org_id),
  foreign key (submitted_by, org_id) references corecheck.users (id, org_id)
);
create trigger poc_checks_updated_at before update on corecheck.poc_checks
  for each row execute function corecheck.set_updated_at();

create table corecheck.poc_answers (
  org_id uuid not null,
  check_id uuid not null,
  question_key text not null,
  value text not null,
  answered_by uuid not null,
  answered_at timestamptz not null,
  received_at timestamptz not null default now(),
  primary key (check_id, question_key),
  foreign key (check_id, org_id) references corecheck.poc_checks (id, org_id),
  foreign key (answered_by, org_id) references corecheck.users (id, org_id)
);

create table corecheck.poc_evidence (
  id uuid primary key,
  org_id uuid not null,
  check_id uuid not null,
  question_key text not null,
  storage_path text not null,
  content_type text not null,
  size_bytes integer not null,
  uploaded_by uuid not null,
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  foreign key (check_id, org_id) references corecheck.poc_checks (id, org_id),
  foreign key (uploaded_by, org_id) references corecheck.users (id, org_id)
);
create index poc_evidence_check_idx on corecheck.poc_evidence (check_id);

-- Every mutation a device sends carries its own id, so a retried upload is
-- recognised and answered with the original outcome instead of applied twice.
create table corecheck.poc_mutations (
  id uuid primary key,
  org_id uuid not null references corecheck.organisations (id),
  user_id uuid not null,
  result jsonb not null,
  received_at timestamptz not null default now(),
  foreign key (user_id, org_id) references corecheck.users (id, org_id)
);

-- ------------------------------------------------------ row-level security

do $$
declare
  t text;
begin
  foreach t in array array[
    'roles', 'role_permissions', 'users', 'user_sessions', 'sites', 'site_areas',
    'teams', 'disciplines', 'user_sites', 'user_teams', 'user_disciplines',
    'poc_checks', 'poc_answers', 'poc_evidence', 'poc_mutations'
  ] loop
    execute format('alter table corecheck.%I enable row level security', t);
    execute format(
      'create policy tenant_isolation on corecheck.%I to corecheck_app
         using (org_id = corecheck.current_org_id())
         with check (org_id = corecheck.current_org_id())',
      t
    );
  end loop;
end
$$;

alter table corecheck.organisations enable row level security;
create policy tenant_own_organisation on corecheck.organisations
  for select to corecheck_app
  using (id = corecheck.current_org_id());
create policy platform_all on corecheck.organisations
  to corecheck_platform
  using (true) with check (true);

alter table corecheck.audit_events enable row level security;
create policy tenant_events on corecheck.audit_events
  to corecheck_app
  using (scope = 'tenant' and org_id = corecheck.current_org_id())
  with check (scope = 'tenant' and org_id = corecheck.current_org_id());
create policy platform_events on corecheck.audit_events
  to corecheck_platform
  using (scope = 'platform')
  with check (scope = 'platform');

-- -------------------------------------------------------------- privileges

grant select on corecheck.organisations to corecheck_app;
grant select, insert, update on
  corecheck.roles, corecheck.users, corecheck.sites, corecheck.site_areas,
  corecheck.teams, corecheck.disciplines, corecheck.poc_checks,
  corecheck.poc_answers
  to corecheck_app;
grant select, insert, update, delete on
  corecheck.role_permissions, corecheck.user_sites, corecheck.user_teams,
  corecheck.user_disciplines
  to corecheck_app;
grant select, update on corecheck.user_sessions to corecheck_app;
grant select, insert on
  corecheck.audit_events, corecheck.poc_evidence, corecheck.poc_mutations
  to corecheck_app;
grant execute on function
  corecheck.current_org_id(), corecheck.current_user_id(),
  corecheck.username_taken(text)
  to corecheck_app;

grant select, insert, update on corecheck.organisations, corecheck.platform_staff
  to corecheck_platform;
grant select, update on corecheck.staff_sessions to corecheck_platform;
grant select, insert on corecheck.audit_events to corecheck_platform;
grant execute on function corecheck.current_org_id() to corecheck_platform;

-- The only customer data internal staff can see (IAD-004): user counts per
-- organisation and who the Organisation Admins are. Each is a narrow,
-- read-only window; staff have no privileges on the customer tables.
create function corecheck.organisation_user_counts()
  returns table (org_id uuid, active_users integer, locked_users integer, inactive_users integer)
  language sql stable
  security definer
  set search_path = ''
  as $$
    select u.org_id,
           (count(*) filter (where u.status = 'active'))::integer,
           (count(*) filter (where u.status = 'locked'))::integer,
           (count(*) filter (where u.status = 'inactive'))::integer
      from corecheck.users u
     group by u.org_id
  $$;
revoke all on function corecheck.organisation_user_counts() from public;
grant execute on function corecheck.organisation_user_counts() to corecheck_platform;

create function corecheck.organisation_admins(target_org uuid)
  returns table (id uuid, first_name text, last_name text, username text,
                 status text, last_login_at timestamptz)
  language sql stable
  security definer
  set search_path = ''
  as $$
    select u.id, u.first_name, u.last_name, u.username, u.status, u.last_login_at
      from corecheck.users u
      join corecheck.roles r on r.id = u.role_id
     where u.org_id = target_org and r.standard_key = 'admin'
     order by u.last_name, u.first_name
  $$;
revoke all on function corecheck.organisation_admins(uuid) from public;
grant execute on function corecheck.organisation_admins(uuid) to corecheck_platform;
`;

const SCHEMA_DOWN = /* sql */ `
drop schema corecheck cascade;
`;

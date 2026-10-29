import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Milestone 2, part 4: plant reception (FRD 8) on versioned check templates
 * (FRD 10, reception purpose; Milestone 3 adds the other purposes).
 *
 * - A template has versions. A draft can change; publishing freezes it, and
 *   editing a published template starts a new draft (TMP-002..005). Each
 *   check keeps the version it was started from (REC-008).
 * - Questions live in the version as JSON, each with a stable id so answers
 *   and evidence still match after later versions reorder or reword them.
 * - A reception check belongs to a plant. Answers record who gave each one
 *   (REC-008, attribution); every submission is kept as a snapshot, so a
 *   check returned for correction never loses what was first sent (REC-AC-04).
 */
const UP = /* sql */ `
create table corecheck.check_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references corecheck.organisations (id),
  purpose text not null check (purpose in ('reception')),
  name text not null,
  description text,
  archived_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint check_templates_id_org_key unique (id, org_id),
  foreign key (created_by, org_id) references corecheck.users (id, org_id)
);
create unique index check_templates_org_name_key
  on corecheck.check_templates (org_id, lower(name));
create trigger check_templates_updated_at before update on corecheck.check_templates
  for each row execute function corecheck.set_updated_at();

create table corecheck.check_template_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  template_id uuid not null,
  version integer not null check (version > 0),
  state text not null default 'draft' check (state in ('draft', 'published')),
  approval_mode text not null default 'manual' check (approval_mode in ('automatic', 'manual')),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  published_at timestamptz,
  published_by uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint check_template_versions_id_org_key unique (id, org_id),
  constraint check_template_versions_number_key unique (template_id, version),
  constraint check_template_versions_published check (
    state = 'draft' or (published_at is not null and published_by is not null)
  ),
  foreign key (template_id, org_id) references corecheck.check_templates (id, org_id),
  foreign key (published_by, org_id) references corecheck.users (id, org_id),
  foreign key (created_by, org_id) references corecheck.users (id, org_id)
);
-- At most one draft per template at a time.
create unique index check_template_versions_one_draft
  on corecheck.check_template_versions (template_id) where state = 'draft';
create trigger check_template_versions_updated_at before update on corecheck.check_template_versions
  for each row execute function corecheck.set_updated_at();

-- A published version can never change (TMP-003, TMP-AC-02).
create function corecheck.freeze_published_template() returns trigger
  language plpgsql
  as $$
begin
  if old.state = 'published' then
    raise exception using
      errcode = 'CC003',
      message = 'TEMPLATE_VERSION_PUBLISHED',
      detail = 'A published template version cannot be changed.';
  end if;
  return new;
end
$$;
create trigger check_template_versions_frozen before update or delete on corecheck.check_template_versions
  for each row execute function corecheck.freeze_published_template();

create table corecheck.reception_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  plant_id uuid not null,
  template_version_id uuid not null,
  -- open: being filled in; returned: sent back for correction; submitted:
  -- awaiting approval; approved / restricted: finished; cancelled.
  status text not null default 'open'
    check (status in ('open', 'returned', 'submitted', 'approved', 'restricted', 'cancelled')),
  assigned_by uuid not null,
  assigned_at timestamptz not null default now(),
  submitted_by uuid,
  submitted_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_comment text,
  -- Why a submission did not go straight Online (failed questions, documents).
  outcome_reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reception_checks_id_org_key unique (id, org_id),
  foreign key (plant_id, org_id) references corecheck.plants (id, org_id),
  foreign key (template_version_id, org_id) references corecheck.check_template_versions (id, org_id),
  foreign key (assigned_by, org_id) references corecheck.users (id, org_id),
  foreign key (submitted_by, org_id) references corecheck.users (id, org_id),
  foreign key (reviewed_by, org_id) references corecheck.users (id, org_id)
);
create index reception_checks_plant_idx on corecheck.reception_checks (plant_id);
-- One reception in progress per plant.
create unique index reception_checks_one_active on corecheck.reception_checks (plant_id)
  where status in ('open', 'returned', 'submitted');
create trigger reception_checks_updated_at before update on corecheck.reception_checks
  for each row execute function corecheck.set_updated_at();

create table corecheck.reception_answers (
  org_id uuid not null,
  check_id uuid not null,
  question_id text not null,
  value jsonb,
  comment text,
  answered_by uuid not null,
  answered_at timestamptz not null default now(),
  primary key (check_id, question_id),
  foreign key (check_id, org_id) references corecheck.reception_checks (id, org_id),
  foreign key (answered_by, org_id) references corecheck.users (id, org_id)
);

create table corecheck.reception_evidence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  check_id uuid not null,
  question_id text not null,
  storage_path text not null,
  file_name text not null,
  content_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  uploaded_by uuid not null,
  uploaded_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint reception_evidence_id_org_key unique (id, org_id),
  foreign key (check_id, org_id) references corecheck.reception_checks (id, org_id),
  foreign key (uploaded_by, org_id) references corecheck.users (id, org_id)
);
create index reception_evidence_check_idx on corecheck.reception_evidence (check_id);

-- Each submission as it was sent: answers, evidence ids and the outcome.
create table corecheck.reception_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  check_id uuid not null,
  submitted_by uuid not null,
  submitted_at timestamptz not null default now(),
  answers jsonb not null,
  outcome text not null check (outcome in ('awaiting_approval', 'approved', 'restricted')),
  outcome_reasons jsonb not null default '[]'::jsonb,
  foreign key (check_id, org_id) references corecheck.reception_checks (id, org_id),
  foreign key (submitted_by, org_id) references corecheck.users (id, org_id)
);
create index reception_submissions_check_idx on corecheck.reception_submissions (check_id);

do $$
declare
  t text;
begin
  foreach t in array array[
    'check_templates', 'check_template_versions', 'reception_checks',
    'reception_answers', 'reception_evidence', 'reception_submissions'
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

grant select, insert, update on
  corecheck.check_templates, corecheck.check_template_versions,
  corecheck.reception_checks, corecheck.reception_evidence
  to corecheck_app;
grant select, insert, update, delete on corecheck.reception_answers to corecheck_app;
grant select, insert on corecheck.reception_submissions to corecheck_app;

-- Reception photos count towards storage usage too (IAD-004).
create or replace function corecheck.organisation_storage_usage()
  returns table (org_id uuid, files integer, bytes bigint)
  language sql stable
  security definer
  set search_path = ''
  as $$
    select f.org_id, count(*)::integer, coalesce(sum(f.size_bytes), 0)::bigint
      from (
        select e.org_id, e.size_bytes from corecheck.poc_evidence e
        union all
        select v.org_id, v.size_bytes from corecheck.plant_document_versions v
        union all
        select r.org_id, r.size_bytes from corecheck.reception_evidence r
      ) f
     group by f.org_id
  $$;
`;

const DOWN = /* sql */ `
create or replace function corecheck.organisation_storage_usage()
  returns table (org_id uuid, files integer, bytes bigint)
  language sql stable
  security definer
  set search_path = ''
  as $$
    select f.org_id, count(*)::integer, coalesce(sum(f.size_bytes), 0)::bigint
      from (
        select e.org_id, e.size_bytes from corecheck.poc_evidence e
        union all
        select v.org_id, v.size_bytes from corecheck.plant_document_versions v
      ) f
     group by f.org_id
  $$;
drop table corecheck.reception_submissions;
drop table corecheck.reception_evidence;
drop table corecheck.reception_answers;
drop table corecheck.reception_checks;
drop table corecheck.check_template_versions;
drop function corecheck.freeze_published_template();
drop table corecheck.check_templates;
`;

export class Reception1761000000000 implements MigrationInterface {
  name = 'Reception1761000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(DOWN);
  }
}

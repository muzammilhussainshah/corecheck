import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Milestone 3: check templates for every purpose (FRD 10), recurring
 * schedules (FRD 11), checks and their evidence (FRD 12), Defects and their
 * verification (FRD 13), and in-app notifications for overdue work and
 * blocked verification (SCH-008, DFW-008).
 *
 * - A template version now also holds who and what it applies to, its
 *   separation-of-duties rule and whether Defect work must record corrective
 *   action and repair evidence. Published versions stay frozen.
 * - A schedule belongs to one plant and one template. It pauses while the
 *   plant is out of service and resumes from the return-to-service date; a
 *   trigger on plants keeps that true whichever code path changes the status.
 * - Every change to an answer is kept, with who made it and, after
 *   submission, why (CHK-004, CHK-010).
 */
const UP = /* sql */ `
-- ---------------------------------------------------------------- templates

alter table corecheck.check_templates drop constraint check_templates_purpose_check;
alter table corecheck.check_templates add constraint check_templates_purpose_check
  check (purpose in ('reception', 'operational', 'technical', 'maintenance', 'defect_verification'));

-- Adding columns does not fire the freeze trigger; published rows keep their
-- questions and take the defaults below, which match how they behaved.
alter table corecheck.check_template_versions
  -- { plantTypeIds, categoryIds, disciplineIds, teamIds, userIds }; an empty
  -- list places no limit (TMP-008).
  add column eligibility jsonb not null default '{}'::jsonb
    check (jsonb_typeof(eligibility) = 'object'),
  -- Who may not approve their own verification (DFW-006, DFW-007).
  add column separation text not null default 'major_critical'
    check (separation in ('none', 'major_critical', 'all')),
  -- Defect work this verification template makes mandatory (DFW-003).
  add column require_corrective_action boolean not null default false,
  add column require_repair_evidence boolean not null default false,
  -- A suggested recurrence for new schedules (TMP-008), or null.
  add column recurrence jsonb;

-- ---------------------------------------------------------------- schedules

create function corecheck.schedule_interval(frequency text, unit text, count integer)
  returns interval
  language sql immutable
  as $$
    select case frequency
      when 'daily' then interval '1 day'
      when 'weekly' then interval '7 days'
      when 'monthly' then interval '1 month'
      when 'quarterly' then interval '3 months'
      when 'annual' then interval '1 year'
      else make_interval(
        days => case unit when 'day' then count when 'week' then count * 7 else 0 end,
        months => case unit when 'month' then count else 0 end,
        years => case unit when 'year' then count else 0 end)
    end
  $$;

create table corecheck.check_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  name text not null,
  template_id uuid not null,
  plant_id uuid not null,
  frequency text not null
    check (frequency in ('daily', 'weekly', 'monthly', 'quarterly', 'annual', 'custom')),
  custom_unit text check (custom_unit in ('day', 'week', 'month', 'year')),
  custom_count integer check (custom_count between 1 and 366),
  -- completion: the next check is due one interval after the last one was
  -- completed (SCH-009); due_date: one interval after the last due date.
  basis text not null default 'completion' check (basis in ('completion', 'due_date')),
  start_on date not null,
  -- The due date of the next check to generate.
  next_due_on date not null,
  -- Only these create an approval step (SCH-011).
  requires_approval boolean not null default false,
  assignee_user_id uuid,
  assignee_team_id uuid,
  assignee_discipline_id uuid,
  -- Paused by an Admin (SCH-001) ...
  paused_at timestamptz,
  paused_by uuid,
  pause_reason text,
  -- ... or because the plant is out of service (SCH-010).
  plant_paused_at timestamptz,
  archived_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint check_schedules_id_org_key unique (id, org_id),
  constraint check_schedules_custom check (
    (frequency = 'custom') = (custom_unit is not null and custom_count is not null)
  ),
  constraint check_schedules_assignee check (
    assignee_user_id is not null or assignee_team_id is not null or assignee_discipline_id is not null
  ),
  foreign key (template_id, org_id) references corecheck.check_templates (id, org_id),
  foreign key (plant_id, org_id) references corecheck.plants (id, org_id),
  foreign key (assignee_user_id, org_id) references corecheck.users (id, org_id),
  foreign key (assignee_team_id, org_id) references corecheck.teams (id, org_id),
  foreign key (assignee_discipline_id, org_id) references corecheck.disciplines (id, org_id),
  foreign key (paused_by, org_id) references corecheck.users (id, org_id),
  foreign key (created_by, org_id) references corecheck.users (id, org_id)
);
create index check_schedules_plant_idx on corecheck.check_schedules (plant_id);
create index check_schedules_template_idx on corecheck.check_schedules (template_id);
create trigger check_schedules_updated_at before update on corecheck.check_schedules
  for each row execute function corecheck.set_updated_at();

-- ------------------------------------------------------------------- checks

create table corecheck.checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  -- Shown as CHK-000001; numbered per organisation by the trigger below.
  ref_no integer not null,
  plant_id uuid not null,
  template_version_id uuid not null,
  source text not null check (source in ('schedule', 'manual', 'defect_verification')),
  schedule_id uuid,
  defect_id uuid,
  -- Appendix A: Scheduled, Due, In Progress, Submitted/Awaiting Review,
  -- Completed, Cancelled/Voided. Returned is In Progress after a review sent
  -- it back; Rejected is a review outcome. Overdue is worked out from the
  -- due date in the organisation's time zone, never stored.
  status text not null
    check (status in ('scheduled', 'due', 'in_progress', 'submitted', 'returned',
                      'completed', 'rejected', 'cancelled')),
  assignee_user_id uuid,
  assignee_team_id uuid,
  assignee_discipline_id uuid,
  available_on date,
  due_on date,
  requires_review boolean not null,
  -- The person who completed it may not approve it (DFW-006).
  separation_required boolean not null default false,
  created_by uuid,
  started_at timestamptz,
  started_by uuid,
  submitted_at timestamptz,
  submitted_by uuid,
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_comment text,
  -- An authorised override of the separation block (DFW-009).
  review_override_reason text,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  overdue_notified_at timestamptz,
  outcome_reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checks_id_org_key unique (id, org_id),
  constraint checks_ref_key unique (org_id, ref_no),
  constraint checks_schedule_source check ((source = 'schedule') = (schedule_id is not null)),
  constraint checks_defect_source check ((source = 'defect_verification') = (defect_id is not null)),
  constraint checks_cancel_reason check (status <> 'cancelled' or cancel_reason is not null),
  foreign key (plant_id, org_id) references corecheck.plants (id, org_id),
  foreign key (template_version_id, org_id) references corecheck.check_template_versions (id, org_id),
  foreign key (schedule_id, org_id) references corecheck.check_schedules (id, org_id),
  foreign key (assignee_user_id, org_id) references corecheck.users (id, org_id),
  foreign key (assignee_team_id, org_id) references corecheck.teams (id, org_id),
  foreign key (assignee_discipline_id, org_id) references corecheck.disciplines (id, org_id),
  foreign key (created_by, org_id) references corecheck.users (id, org_id),
  foreign key (started_by, org_id) references corecheck.users (id, org_id),
  foreign key (submitted_by, org_id) references corecheck.users (id, org_id),
  foreign key (reviewed_by, org_id) references corecheck.users (id, org_id),
  foreign key (cancelled_by, org_id) references corecheck.users (id, org_id)
);
create index checks_plant_idx on corecheck.checks (plant_id);
create index checks_status_due_idx on corecheck.checks (org_id, status, due_on);
create index checks_assignee_idx on corecheck.checks (assignee_user_id);
-- A schedule has one check waiting to be done at a time.
create unique index checks_one_open_per_schedule on corecheck.checks (schedule_id)
  where status in ('scheduled', 'due', 'in_progress');
create trigger checks_updated_at before update on corecheck.checks
  for each row execute function corecheck.set_updated_at();

-- Reference numbers per organisation, in the order checks are created.
create function corecheck.number_record() returns trigger
  language plpgsql
  as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('corecheck.' || tg_table_name || ':' || new.org_id::text, 0));
  execute format('select coalesce(max(ref_no), 0) + 1 from corecheck.%I where org_id = $1', tg_table_name)
    into new.ref_no using new.org_id;
  return new;
end
$$;
create trigger checks_number before insert on corecheck.checks
  for each row execute function corecheck.number_record();

create table corecheck.check_answers (
  org_id uuid not null,
  check_id uuid not null,
  question_id text not null,
  value jsonb,
  comment text,
  answered_by uuid not null,
  answered_at timestamptz not null default now(),
  primary key (check_id, question_id),
  foreign key (check_id, org_id) references corecheck.checks (id, org_id),
  foreign key (answered_by, org_id) references corecheck.users (id, org_id)
);

-- Every answer as given and every later change; never updated (CHK-004).
create table corecheck.check_answer_changes (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  check_id uuid not null,
  question_id text not null,
  previous_value jsonb,
  previous_comment text,
  value jsonb,
  comment text,
  changed_by uuid not null,
  changed_at timestamptz not null default now(),
  -- Edits after submission keep the reason (CHK-010, CHK-AC-04).
  after_submission boolean not null default false,
  reason text,
  constraint check_answer_changes_reason check (not after_submission or reason is not null),
  foreign key (check_id, org_id) references corecheck.checks (id, org_id),
  foreign key (changed_by, org_id) references corecheck.users (id, org_id)
);
create index check_answer_changes_check_idx on corecheck.check_answer_changes (check_id);

create table corecheck.check_evidence (
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
  removed_by uuid,
  constraint check_evidence_id_org_key unique (id, org_id),
  foreign key (check_id, org_id) references corecheck.checks (id, org_id),
  foreign key (uploaded_by, org_id) references corecheck.users (id, org_id),
  foreign key (removed_by, org_id) references corecheck.users (id, org_id)
);
create index check_evidence_check_idx on corecheck.check_evidence (check_id);

-- Each submission as it was sent, kept when the check is returned.
create table corecheck.check_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  check_id uuid not null,
  submitted_by uuid not null,
  submitted_at timestamptz not null default now(),
  answers jsonb not null,
  outcome text not null check (outcome in ('awaiting_review', 'completed')),
  outcome_reasons jsonb not null default '[]'::jsonb,
  foreign key (check_id, org_id) references corecheck.checks (id, org_id),
  foreign key (submitted_by, org_id) references corecheck.users (id, org_id)
);
create index check_submissions_check_idx on corecheck.check_submissions (check_id);

-- ------------------------------------------------------------------ defects

create table corecheck.defects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  -- Shown as DEF-000001.
  ref_no integer not null,
  plant_id uuid not null,
  -- The answer that raised it: from a check or a reception (DEF-002).
  check_id uuid,
  reception_check_id uuid,
  question_id text not null,
  question_text text not null,
  answer jsonb,
  answer_comment text,
  raised_by uuid not null,
  raised_at timestamptz not null default now(),
  severity text not null check (severity in ('minor', 'major', 'critical')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'closed')),
  -- The failed question also took the plant Offline.
  restricts_plant boolean not null default false,
  assignee_user_id uuid,
  corrective_action text,
  repair_notes text,
  work_recorded_by uuid,
  work_recorded_at timestamptz,
  verification_check_id uuid,
  started_at timestamptz,
  started_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_note text,
  reopened_at timestamptz,
  reopened_by uuid,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint defects_id_org_key unique (id, org_id),
  constraint defects_ref_key unique (org_id, ref_no),
  constraint defects_one_source check ((check_id is null) <> (reception_check_id is null)),
  foreign key (plant_id, org_id) references corecheck.plants (id, org_id),
  foreign key (check_id, org_id) references corecheck.checks (id, org_id),
  foreign key (reception_check_id, org_id) references corecheck.reception_checks (id, org_id),
  foreign key (raised_by, org_id) references corecheck.users (id, org_id),
  foreign key (assignee_user_id, org_id) references corecheck.users (id, org_id),
  foreign key (work_recorded_by, org_id) references corecheck.users (id, org_id),
  foreign key (verification_check_id, org_id) references corecheck.checks (id, org_id),
  foreign key (started_by, org_id) references corecheck.users (id, org_id),
  foreign key (closed_by, org_id) references corecheck.users (id, org_id),
  foreign key (reopened_by, org_id) references corecheck.users (id, org_id)
);
create index defects_plant_idx on corecheck.defects (plant_id);
create index defects_status_idx on corecheck.defects (org_id, status);
-- An answer raises at most one Defect, however often its check is resubmitted.
create unique index defects_one_per_check_answer on corecheck.defects (check_id, question_id)
  where check_id is not null;
create unique index defects_one_per_reception_answer on corecheck.defects (reception_check_id, question_id)
  where reception_check_id is not null;
create trigger defects_updated_at before update on corecheck.defects
  for each row execute function corecheck.set_updated_at();
create trigger defects_number before insert on corecheck.defects
  for each row execute function corecheck.number_record();

alter table corecheck.checks add constraint checks_defect_fkey
  foreign key (defect_id, org_id) references corecheck.defects (id, org_id);

create table corecheck.defect_evidence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  defect_id uuid not null,
  storage_path text not null,
  file_name text not null,
  content_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  uploaded_by uuid not null,
  uploaded_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint defect_evidence_id_org_key unique (id, org_id),
  foreign key (defect_id, org_id) references corecheck.defects (id, org_id),
  foreign key (uploaded_by, org_id) references corecheck.users (id, org_id)
);
create index defect_evidence_defect_idx on corecheck.defect_evidence (defect_id);

-- ------------------------------------------------------------ notifications

create table corecheck.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  kind text not null,
  title text not null,
  body text not null,
  link text,
  entity_type text,
  entity_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  foreign key (user_id, org_id) references corecheck.users (id, org_id)
);
create index notifications_user_idx on corecheck.notifications (user_id, created_at desc);

-- ----------------------------------------------------------- meter readings

alter table corecheck.meter_readings drop constraint meter_readings_source_check;
alter table corecheck.meter_readings add constraint meter_readings_source_check
  check (source in ('manual', 'reception', 'check'));
alter table corecheck.meter_readings add column inspection_id uuid;
alter table corecheck.meter_readings add constraint meter_readings_inspection_fkey
  foreign key (inspection_id, org_id) references corecheck.checks (id, org_id);
create unique index meter_readings_one_per_inspection
  on corecheck.meter_readings (inspection_id, meter_type_id) where inspection_id is not null;

-- ------------------------------------------- schedules follow plant status

-- Taking plant out of service pauses its schedules and withdraws checks not
-- yet started, which stay on record as cancelled (SCH-010, SCH-AC-02).
-- Returning it to service resumes them one interval after that date
-- (SCH-AC-03). First approval starts schedules whose start date has passed.
create function corecheck.plant_schedules_follow_status() returns trigger
  language plpgsql
  as $$
declare
  today date;
begin
  if new.status is not distinct from old.status
     and (new.archived_at is null) = (old.archived_at is null) then
    return new;
  end if;
  select (now() at time zone o.time_zone)::date into today
    from corecheck.organisations o where o.id = new.org_id;

  if (old.status = 'approved' and old.archived_at is null)
     and (new.status <> 'approved' or new.archived_at is not null) then
    update corecheck.check_schedules
       set plant_paused_at = now()
     where plant_id = new.id and plant_paused_at is null;
    with withdrawn as (
      update corecheck.checks
         set status = 'cancelled', cancelled_at = now(),
             cancel_reason = 'Schedule paused: the plant is out of service'
       where plant_id = new.id and schedule_id is not null
         and status in ('scheduled', 'due')
      returning id, org_id, ref_no
    )
    insert into corecheck.audit_events
      (scope, org_id, actor_type, actor_name, action, entity_type, entity_id, summary, metadata)
    select 'tenant', w.org_id, 'system', 'Check schedule', 'check.cancelled', 'check', w.id::text,
           'Cancelled CHK-' || lpad(w.ref_no::text, 6, '0') || ': schedule paused while the plant is out of service',
           jsonb_build_object('plantId', new.id, 'automatic', true)
      from withdrawn w;
  elsif new.status = 'approved' and new.archived_at is null then
    update corecheck.check_schedules s
       set plant_paused_at = null,
           next_due_on = greatest(
             s.start_on,
             (today + corecheck.schedule_interval(s.frequency, s.custom_unit, s.custom_count))::date)
     where s.plant_id = new.id and s.plant_paused_at is not null;
    update corecheck.check_schedules s
       set next_due_on = today
     where s.plant_id = new.id and s.plant_paused_at is null and s.next_due_on < today
       and not exists (
         select 1 from corecheck.checks c
          where c.schedule_id = s.id and c.status in ('scheduled', 'due', 'in_progress'));
  end if;
  return new;
end
$$;
create trigger plants_schedules_follow_status after update of status, archived_at on corecheck.plants
  for each row execute function corecheck.plant_schedules_follow_status();

-- ---------------------------------------------------------------- isolation

do $$
declare
  t text;
begin
  foreach t in array array[
    'check_schedules', 'checks', 'check_answers', 'check_answer_changes',
    'check_evidence', 'check_submissions', 'defects', 'defect_evidence',
    'notifications'
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
  corecheck.check_schedules, corecheck.checks, corecheck.check_evidence,
  corecheck.defects, corecheck.defect_evidence, corecheck.notifications
  to corecheck_app;
grant select, insert, update, delete on corecheck.check_answers to corecheck_app;
grant select, insert on corecheck.check_answer_changes, corecheck.check_submissions to corecheck_app;
grant execute on function corecheck.schedule_interval(text, text, integer) to corecheck_app;

-- Check and repair evidence count towards storage usage too (IAD-004).
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
        union all
        select c.org_id, c.size_bytes from corecheck.check_evidence c
        union all
        select d.org_id, d.size_bytes from corecheck.defect_evidence d
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
        union all
        select r.org_id, r.size_bytes from corecheck.reception_evidence r
      ) f
     group by f.org_id
  $$;
drop trigger plants_schedules_follow_status on corecheck.plants;
drop function corecheck.plant_schedules_follow_status();
drop index corecheck.meter_readings_one_per_inspection;
alter table corecheck.meter_readings drop constraint meter_readings_inspection_fkey;
alter table corecheck.meter_readings drop column inspection_id;
delete from corecheck.meter_readings where source = 'check';
alter table corecheck.meter_readings drop constraint meter_readings_source_check;
alter table corecheck.meter_readings add constraint meter_readings_source_check
  check (source in ('manual', 'reception'));
drop table corecheck.notifications;
alter table corecheck.checks drop constraint checks_defect_fkey;
drop table corecheck.defect_evidence;
drop table corecheck.defects;
drop table corecheck.check_submissions;
drop table corecheck.check_evidence;
drop table corecheck.check_answer_changes;
drop table corecheck.check_answers;
drop table corecheck.checks;
drop function corecheck.number_record();
drop table corecheck.check_schedules;
drop function corecheck.schedule_interval(text, text, integer);
alter table corecheck.check_template_versions
  drop column eligibility,
  drop column separation,
  drop column require_corrective_action,
  drop column require_repair_evidence,
  drop column recurrence;
alter table corecheck.check_templates drop constraint check_templates_purpose_check;
alter table corecheck.check_templates add constraint check_templates_purpose_check
  check (purpose in ('reception'));
`;

export class ChecksAndDefects1761700000000 implements MigrationInterface {
  name = 'ChecksAndDefects1761700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(DOWN);
  }
}

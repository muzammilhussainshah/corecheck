import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Milestone 2, part 3: plant documents and compliance (FRD 9).
 *
 * - A document is one certificate or record held for a plant; each upload is
 *   a version, so replacing a document keeps the earlier file and its
 *   verification history (DOC-007, DOC-AC-02).
 * - A document's status is never stored: the views below work it out from
 *   the current version, the type's expiry warning and today's date in the
 *   organisation's time zone, so "Expired" is right the moment the date
 *   passes (DOC-004, DOC-005).
 * - plant_requirement_states answers "does this plant hold each document its
 *   type requires?" (DOC-001, DOC-006) for the API's compliance checks.
 * - The views run with the caller's rights, so row-level security applies.
 */
const UP = /* sql */ `
create table corecheck.plant_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references corecheck.organisations (id),
  plant_id uuid not null,
  document_type_id uuid not null,
  current_version_id uuid,
  created_by uuid not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plant_documents_id_org_key unique (id, org_id),
  foreign key (plant_id, org_id) references corecheck.plants (id, org_id),
  foreign key (document_type_id, org_id) references corecheck.document_types (id, org_id),
  foreign key (created_by, org_id) references corecheck.users (id, org_id)
);
create index plant_documents_plant_idx on corecheck.plant_documents (plant_id);
create index plant_documents_type_idx on corecheck.plant_documents (document_type_id);
create trigger plant_documents_updated_at before update on corecheck.plant_documents
  for each row execute function corecheck.set_updated_at();

create table corecheck.plant_document_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  document_id uuid not null,
  version integer not null check (version > 0),
  reference text,
  issued_on date,
  expires_on date,
  storage_path text not null,
  file_name text not null,
  content_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  uploaded_by uuid not null,
  uploaded_at timestamptz not null default now(),
  verification text not null default 'awaiting'
    check (verification in ('awaiting', 'verified', 'rejected')),
  verified_by uuid,
  verified_at timestamptz,
  rejection_reason text,
  constraint plant_document_versions_id_org_key unique (id, org_id),
  constraint plant_document_versions_number_key unique (document_id, version),
  constraint plant_document_versions_dates check (
    issued_on is null or expires_on is null or expires_on >= issued_on
  ),
  constraint plant_document_versions_rejection_reason check (
    verification <> 'rejected' or rejection_reason is not null
  ),
  foreign key (document_id, org_id) references corecheck.plant_documents (id, org_id),
  foreign key (uploaded_by, org_id) references corecheck.users (id, org_id),
  foreign key (verified_by, org_id) references corecheck.users (id, org_id)
);

alter table corecheck.plant_documents
  add constraint plant_documents_current_version_fkey
  foreign key (current_version_id, org_id)
  references corecheck.plant_document_versions (id, org_id);

-- An authorised override of a document restriction: plant may stay in use
-- until the review date despite missing or expired documents (DOC-008).
alter table corecheck.plants
  add column compliance_override_until date,
  add column compliance_override_note text,
  add column compliance_override_by uuid,
  add constraint plants_override_by_fkey
    foreign key (compliance_override_by, org_id) references corecheck.users (id, org_id),
  add constraint plants_override_complete check (
    compliance_override_until is null
    or (compliance_override_note is not null and compliance_override_by is not null)
  );

-- Each document's status from its current version (DOC-005).
create view corecheck.plant_document_states with (security_invoker = true) as
select d.org_id, d.id as document_id, d.plant_id, d.document_type_id,
       v.id as version_id, v.expires_on,
       case
         when d.archived_at is not null then 'archived'
         when v.verification = 'rejected' then 'rejected'
         when t.has_expiry and v.expires_on < today.value then 'expired'
         when v.verification = 'awaiting' then 'awaiting_verification'
         when t.has_expiry and v.expires_on <= today.value + t.warning_days
           then 'approaching_expiry'
         else 'valid'
       end as state
  from corecheck.plant_documents d
  join corecheck.plant_document_versions v on v.id = d.current_version_id
  join corecheck.document_types t on t.id = d.document_type_id
  join corecheck.organisations o on o.id = d.org_id
  cross join lateral (select (now() at time zone o.time_zone)::date as value) today;

-- For each plant, each document its type requires and the best state any of
-- its documents of that type is in; "missing" when it holds none (DOC-006).
-- Archived document types are no longer required.
create view corecheck.plant_requirement_states with (security_invoker = true) as
select p.org_id, p.id as plant_id, r.document_type_id, t.name as document_type_name,
       coalesce(best.state, 'missing') as state
  from corecheck.plants p
  join corecheck.plant_type_required_documents r on r.plant_type_id = p.plant_type_id
  join corecheck.document_types t on t.id = r.document_type_id and t.archived_at is null
  left join lateral (
    select s.state
      from corecheck.plant_document_states s
     where s.plant_id = p.id
       and s.document_type_id = r.document_type_id
       and s.state <> 'archived'
     order by case s.state
                when 'valid' then 1
                when 'approaching_expiry' then 2
                when 'awaiting_verification' then 3
                when 'rejected' then 4
                else 5
              end
     limit 1
  ) best on true;

do $$
declare
  t text;
begin
  foreach t in array array['plant_documents', 'plant_document_versions'] loop
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
  corecheck.plant_documents, corecheck.plant_document_versions
  to corecheck_app;
grant select on
  corecheck.plant_document_states, corecheck.plant_requirement_states
  to corecheck_app;

-- Internal portal storage totals now include plant documents (IAD-004).
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
`;

const DOWN = /* sql */ `
create or replace function corecheck.organisation_storage_usage()
  returns table (org_id uuid, files integer, bytes bigint)
  language sql stable
  security definer
  set search_path = ''
  as $$
    select e.org_id, count(*)::integer, coalesce(sum(e.size_bytes), 0)::bigint
      from corecheck.poc_evidence e
     group by e.org_id
  $$;
drop view corecheck.plant_requirement_states;
drop view corecheck.plant_document_states;
alter table corecheck.plants
  drop constraint plants_override_complete,
  drop constraint plants_override_by_fkey,
  drop column compliance_override_by,
  drop column compliance_override_note,
  drop column compliance_override_until;
alter table corecheck.plant_documents drop constraint plant_documents_current_version_fkey;
drop table corecheck.plant_document_versions;
drop table corecheck.plant_documents;
`;

export class PlantDocuments1760900000000 implements MigrationInterface {
  name = 'PlantDocuments1760900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(DOWN);
  }
}

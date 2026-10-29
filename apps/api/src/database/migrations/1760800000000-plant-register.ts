import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Milestone 2, part 2: the plant register (FRD 7).
 *
 * - One row per System Asset ID; the ID is unique within an organisation
 *   (PLT-001..003). Plant Number and Serial Number are indexed for duplicate
 *   warnings but deliberately not unique (PLT-004).
 * - The primary lifecycle is status (PLC-001); Quarantined, Not in Use and
 *   Off-hired are a classification beside it, never a status (PLC-002).
 *   Archiving is a timestamp, so restoring returns the plant to the status it
 *   had (PLC-006).
 * - An area must be on the plant's own site: the composite key makes the
 *   database refuse anything else.
 * - Each plant has a random QR token; the code never carries the plant id
 *   or any plant information (PLT-AC-04).
 */
const UP = /* sql */ `
alter table corecheck.site_areas
  add constraint site_areas_id_site_key unique (id, site_id);

-- Next generated System Asset ID per organisation (PLT-002).
create table corecheck.plant_asset_counters (
  org_id uuid primary key references corecheck.organisations (id),
  next_value integer not null default 1 check (next_value > 0)
);

create table corecheck.plants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references corecheck.organisations (id),
  asset_id text not null check (length(asset_id) between 1 and 40),
  plant_number text,
  serial_number text,
  name text not null check (length(name) between 1 and 160),
  plant_type_id uuid not null,
  category_id uuid,
  make text,
  model text,
  ownership text not null check (ownership in ('owned', 'hired')),
  company_id uuid not null,
  site_id uuid not null,
  area_id uuid,
  custom_values jsonb not null default '{}'::jsonb
    check (jsonb_typeof(custom_values) = 'object'),
  status text not null default 'pending_reception'
    check (status in ('pending_reception', 'awaiting_approval', 'approved', 'restricted')),
  -- Why restricted plant is out of use (PLC-002); only while restricted.
  restriction_reason text
    check (restriction_reason in ('quarantined', 'not_in_use', 'off_hired')),
  status_note text,
  status_changed_at timestamptz not null default now(),
  status_changed_by uuid,
  -- Last approval (REC-AC-03). Plant never approved returns to Pending
  -- Reception, not Online, when a restriction is lifted.
  approved_at timestamptz,
  approved_by uuid,
  qr_token text not null,
  created_by uuid not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plants_id_org_key unique (id, org_id),
  constraint plants_reason_only_when_restricted check (
    restriction_reason is null or status = 'restricted'
  ),
  foreign key (plant_type_id, org_id) references corecheck.plant_types (id, org_id),
  foreign key (category_id, org_id) references corecheck.plant_categories (id, org_id),
  foreign key (company_id, org_id) references corecheck.plant_companies (id, org_id),
  foreign key (site_id, org_id) references corecheck.sites (id, org_id),
  foreign key (area_id, org_id) references corecheck.site_areas (id, org_id),
  foreign key (area_id, site_id) references corecheck.site_areas (id, site_id),
  foreign key (created_by, org_id) references corecheck.users (id, org_id),
  foreign key (status_changed_by, org_id) references corecheck.users (id, org_id),
  foreign key (approved_by, org_id) references corecheck.users (id, org_id)
);
-- PLT-AC-01: never two plant records with one System Asset ID.
create unique index plants_org_asset_id_key on corecheck.plants (org_id, lower(asset_id));
create unique index plants_qr_token_key on corecheck.plants (qr_token);
create index plants_org_plant_number_idx on corecheck.plants (org_id, lower(plant_number))
  where plant_number is not null;
create index plants_org_serial_number_idx on corecheck.plants (org_id, lower(serial_number))
  where serial_number is not null;
create index plants_org_site_idx on corecheck.plants (org_id, site_id);
create index plants_org_status_idx on corecheck.plants (org_id, status);
create trigger plants_updated_at before update on corecheck.plants
  for each row execute function corecheck.set_updated_at();

create table corecheck.plant_disciplines (
  org_id uuid not null,
  plant_id uuid not null,
  discipline_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (plant_id, discipline_id),
  foreign key (plant_id, org_id) references corecheck.plants (id, org_id),
  foreign key (discipline_id, org_id) references corecheck.disciplines (id, org_id)
);
create index plant_disciplines_discipline_idx on corecheck.plant_disciplines (discipline_id);

-- QR codes are scanned before the app knows whose plant it is: this finds
-- the plant's organisation and nothing else. The API then answers only if
-- the signed-in user is in that organisation and the plant's scope.
create function corecheck.plant_by_qr_token(token text)
  returns table (plant_id uuid, org_id uuid)
  language sql stable
  security definer
  set search_path = ''
  as $$ select p.id, p.org_id from corecheck.plants p where p.qr_token = token $$;
revoke all on function corecheck.plant_by_qr_token(text) from public;
grant execute on function corecheck.plant_by_qr_token(text) to corecheck_app;

do $$
declare
  t text;
begin
  foreach t in array array['plant_asset_counters', 'plants', 'plant_disciplines'] loop
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

grant select, insert, update on corecheck.plant_asset_counters, corecheck.plants
  to corecheck_app;
grant select, insert, delete on corecheck.plant_disciplines to corecheck_app;
`;

const DOWN = /* sql */ `
drop function corecheck.plant_by_qr_token(text);
drop table corecheck.plant_disciplines;
drop table corecheck.plants;
drop table corecheck.plant_asset_counters;
alter table corecheck.site_areas drop constraint site_areas_id_site_key;
`;

export class PlantRegister1760800000000 implements MigrationInterface {
  name = 'PlantRegister1760800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(DOWN);
  }
}

import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Milestone 2, part 5: meter readings (FRD 14). A reading keeps its plant,
 * meter type, value, unit, time, source and recorder (MTR-004). Correcting
 * one changes the current value but keeps every earlier value, with who
 * corrected it and why (MTR-005).
 */
const UP = /* sql */ `
create table corecheck.meter_readings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  plant_id uuid not null,
  meter_type_id uuid not null,
  value numeric(14, 2) not null check (value >= 0),
  unit text not null,
  read_at timestamptz not null,
  source text not null check (source in ('manual', 'reception')),
  check_id uuid,
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  constraint meter_readings_id_org_key unique (id, org_id),
  foreign key (plant_id, org_id) references corecheck.plants (id, org_id),
  foreign key (meter_type_id, org_id) references corecheck.meter_types (id, org_id),
  foreign key (check_id, org_id) references corecheck.reception_checks (id, org_id),
  foreign key (recorded_by, org_id) references corecheck.users (id, org_id)
);
create index meter_readings_plant_time_idx on corecheck.meter_readings (plant_id, read_at desc);
-- A reception records each meter once, however often it is reviewed.
create unique index meter_readings_one_per_check
  on corecheck.meter_readings (check_id, meter_type_id) where check_id is not null;

create table corecheck.meter_reading_corrections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  reading_id uuid not null,
  previous_value numeric(14, 2) not null,
  new_value numeric(14, 2) not null,
  reason text not null,
  corrected_by uuid not null,
  corrected_at timestamptz not null default now(),
  foreign key (reading_id, org_id) references corecheck.meter_readings (id, org_id),
  foreign key (corrected_by, org_id) references corecheck.users (id, org_id)
);
create index meter_reading_corrections_reading_idx
  on corecheck.meter_reading_corrections (reading_id);

do $$
declare
  t text;
begin
  foreach t in array array['meter_readings', 'meter_reading_corrections'] loop
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

grant select, insert, update on corecheck.meter_readings to corecheck_app;
grant select, insert on corecheck.meter_reading_corrections to corecheck_app;
`;

const DOWN = /* sql */ `
drop table corecheck.meter_reading_corrections;
drop table corecheck.meter_readings;
`;

export class MeterReadings1761100000000 implements MigrationInterface {
  name = 'MeterReadings1761100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(DOWN);
  }
}

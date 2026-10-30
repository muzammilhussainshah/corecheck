import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Milestone 2, part 6: plant import (FRD 19). Each upload is kept with its
 * rows, so invalid rows stay in the application for correction and later
 * import without re-uploading the file (IMP-005), and every import records
 * who ran it, when, the file and each row's outcome (IMP-006).
 */
const UP = /* sql */ `
create table corecheck.plant_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references corecheck.organisations (id),
  file_name text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint plant_imports_id_org_key unique (id, org_id),
  foreign key (created_by, org_id) references corecheck.users (id, org_id)
);
create index plant_imports_org_time_idx on corecheck.plant_imports (org_id, created_at desc);

create table corecheck.plant_import_rows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  import_id uuid not null,
  row_number integer not null,
  data jsonb not null,
  status text not null check (status in ('valid', 'warning', 'invalid', 'imported')),
  problems jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  -- A row with possible duplicates goes in only once someone confirms it.
  confirmed boolean not null default false,
  existing_plant_id uuid,
  plant_id uuid,
  constraint plant_import_rows_number_key unique (import_id, row_number),
  foreign key (import_id, org_id) references corecheck.plant_imports (id, org_id),
  foreign key (existing_plant_id, org_id) references corecheck.plants (id, org_id),
  foreign key (plant_id, org_id) references corecheck.plants (id, org_id)
);

do $$
declare
  t text;
begin
  foreach t in array array['plant_imports', 'plant_import_rows'] loop
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

grant select, insert on corecheck.plant_imports to corecheck_app;
grant select, insert, update on corecheck.plant_import_rows to corecheck_app;
`;

const DOWN = /* sql */ `
drop table corecheck.plant_import_rows;
drop table corecheck.plant_imports;
`;

export class PlantImports1761200000000 implements MigrationInterface {
  name = 'PlantImports1761200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(DOWN);
  }
}

import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Milestone 2 cross-check against the FRD.
 *
 * - Plant details an organisation makes mandatory (PLT-008). Plant Number,
 *   Serial Number, make and model may otherwise be added after reception;
 *   a missing mandatory one prevents automatic approval (REC-007).
 * - An import row can be skipped when the existing plant is used instead
 *   (IPL-006), and keeps every plant it may duplicate (IPL-005).
 */
const UP = /* sql */ `
create table corecheck.plant_settings (
  org_id uuid primary key references corecheck.organisations (id),
  required_fields jsonb not null default '[]'::jsonb
    check (jsonb_typeof(required_fields) = 'array'),
  updated_at timestamptz not null default now()
);
create trigger plant_settings_updated_at before update on corecheck.plant_settings
  for each row execute function corecheck.set_updated_at();

alter table corecheck.plant_settings enable row level security;
create policy tenant_isolation on corecheck.plant_settings to corecheck_app
  using (org_id = corecheck.current_org_id())
  with check (org_id = corecheck.current_org_id());
grant select, insert, update on corecheck.plant_settings to corecheck_app;

alter table corecheck.plant_import_rows
  drop constraint plant_import_rows_status_check,
  add constraint plant_import_rows_status_check
    check (status in ('valid', 'warning', 'invalid', 'imported', 'skipped')),
  add column matching_plant_ids jsonb not null default '[]'::jsonb
    check (jsonb_typeof(matching_plant_ids) = 'array');
`;

const DOWN = /* sql */ `
update corecheck.plant_import_rows set status = 'invalid' where status = 'skipped';
alter table corecheck.plant_import_rows
  drop column matching_plant_ids,
  drop constraint plant_import_rows_status_check,
  add constraint plant_import_rows_status_check
    check (status in ('valid', 'warning', 'invalid', 'imported'));
drop table corecheck.plant_settings;
`;

export class PlantSettingsAndImportRows1761400000000 implements MigrationInterface {
  name = 'PlantSettingsAndImportRows1761400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(DOWN);
  }
}

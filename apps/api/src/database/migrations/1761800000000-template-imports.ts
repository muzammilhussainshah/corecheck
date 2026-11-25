import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Milestone 3: check template import (FRD 19.4). An upload is kept as rows,
 * one per question, and creates nothing until committed; templates are then
 * created as Drafts for an Admin to review and publish (ITM-001).
 */
const UP = /* sql */ `
create table corecheck.template_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  file_name text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint template_imports_id_org_key unique (id, org_id),
  foreign key (created_by, org_id) references corecheck.users (id, org_id)
);

create table corecheck.template_import_rows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  import_id uuid not null,
  row_number integer not null,
  data jsonb not null,
  status text not null check (status in ('valid', 'invalid', 'imported')),
  problems jsonb not null default '[]'::jsonb,
  template_id uuid,
  foreign key (import_id, org_id) references corecheck.template_imports (id, org_id),
  foreign key (template_id, org_id) references corecheck.check_templates (id, org_id)
);
create index template_import_rows_import_idx on corecheck.template_import_rows (import_id);

do $$
declare
  t text;
begin
  foreach t in array array['template_imports', 'template_import_rows'] loop
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

grant select, insert on corecheck.template_imports to corecheck_app;
grant select, insert, update on corecheck.template_import_rows to corecheck_app;
`;

const DOWN = /* sql */ `
drop table corecheck.template_import_rows;
drop table corecheck.template_imports;
`;

export class TemplateImports1761800000000 implements MigrationInterface {
  name = 'TemplateImports1761800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(DOWN);
  }
}

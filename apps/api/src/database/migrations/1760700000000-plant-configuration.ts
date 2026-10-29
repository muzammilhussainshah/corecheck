import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Milestone 2, part 1: the configuration an Admin sets up before plant can
 * be registered (FRD ADM-003). Plant types, categories, owner and hire
 * companies, plant custom fields (PLT-008), meter types (MTR-001), document
 * types with their expiry warning (DOC-001, DOC-005) and the documents each
 * plant type must hold (DOC-001).
 *
 * Same isolation as Milestone 1: org_id on every row, composite (id, org_id)
 * keys between tables, and row-level security for the customer role.
 */
const UP = /* sql */ `
create table corecheck.plant_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references corecheck.organisations (id),
  name text not null,
  description text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plant_types_id_org_key unique (id, org_id)
);
create unique index plant_types_org_name_key on corecheck.plant_types (org_id, lower(name));
create trigger plant_types_updated_at before update on corecheck.plant_types
  for each row execute function corecheck.set_updated_at();

create table corecheck.plant_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references corecheck.organisations (id),
  name text not null,
  description text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plant_categories_id_org_key unique (id, org_id)
);
create unique index plant_categories_org_name_key on corecheck.plant_categories (org_id, lower(name));
create trigger plant_categories_updated_at before update on corecheck.plant_categories
  for each row execute function corecheck.set_updated_at();

-- Who owns a plant item: the organisation itself or a group company for
-- owned plant, a hire company for hired plant (PLT-006).
create table corecheck.plant_companies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references corecheck.organisations (id),
  kind text not null check (kind in ('owner', 'hire_company')),
  name text not null,
  contact_name text,
  contact_phone text,
  contact_email text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plant_companies_id_org_key unique (id, org_id)
);
create unique index plant_companies_org_kind_name_key
  on corecheck.plant_companies (org_id, kind, lower(name));
create trigger plant_companies_updated_at before update on corecheck.plant_companies
  for each row execute function corecheck.set_updated_at();

-- Extra plant fields an Admin defines (PLT-008). The type cannot change once
-- created, so stored values always match it.
create table corecheck.plant_custom_fields (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references corecheck.organisations (id),
  label text not null,
  field_type text not null check (field_type in ('text', 'number', 'date', 'select')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  required boolean not null default false,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plant_custom_fields_id_org_key unique (id, org_id),
  constraint plant_custom_fields_select_options check (
    field_type <> 'select' or jsonb_array_length(options) > 0
  )
);
create unique index plant_custom_fields_org_label_key
  on corecheck.plant_custom_fields (org_id, lower(label));
create trigger plant_custom_fields_updated_at before update on corecheck.plant_custom_fields
  for each row execute function corecheck.set_updated_at();

create table corecheck.meter_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references corecheck.organisations (id),
  name text not null,
  unit text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meter_types_id_org_key unique (id, org_id)
);
create unique index meter_types_org_name_key on corecheck.meter_types (org_id, lower(name));
create trigger meter_types_updated_at before update on corecheck.meter_types
  for each row execute function corecheck.set_updated_at();

create table corecheck.document_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references corecheck.organisations (id),
  name text not null,
  description text,
  has_expiry boolean not null default true,
  -- Days before expiry at which a document shows Approaching Expiry (DOC-005).
  warning_days integer not null default 30 check (warning_days between 0 and 365),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_types_id_org_key unique (id, org_id)
);
create unique index document_types_org_name_key on corecheck.document_types (org_id, lower(name));
create trigger document_types_updated_at before update on corecheck.document_types
  for each row execute function corecheck.set_updated_at();

-- Documents a plant of a given type must hold before it can be approved (DOC-001).
create table corecheck.plant_type_required_documents (
  org_id uuid not null,
  plant_type_id uuid not null,
  document_type_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (plant_type_id, document_type_id),
  foreign key (plant_type_id, org_id) references corecheck.plant_types (id, org_id),
  foreign key (document_type_id, org_id) references corecheck.document_types (id, org_id)
);
create index plant_type_required_documents_doc_idx
  on corecheck.plant_type_required_documents (document_type_id);

do $$
declare
  t text;
begin
  foreach t in array array[
    'plant_types', 'plant_categories', 'plant_companies', 'plant_custom_fields',
    'meter_types', 'document_types', 'plant_type_required_documents'
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
  corecheck.plant_types, corecheck.plant_categories, corecheck.plant_companies,
  corecheck.plant_custom_fields, corecheck.meter_types, corecheck.document_types
  to corecheck_app;
grant select, insert, delete on corecheck.plant_type_required_documents to corecheck_app;
`;

const DOWN = /* sql */ `
drop table corecheck.plant_type_required_documents;
drop table corecheck.document_types;
drop table corecheck.meter_types;
drop table corecheck.plant_custom_fields;
drop table corecheck.plant_companies;
drop table corecheck.plant_categories;
drop table corecheck.plant_types;
`;

export class PlantConfiguration1760700000000 implements MigrationInterface {
  name = 'PlantConfiguration1760700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(DOWN);
  }
}

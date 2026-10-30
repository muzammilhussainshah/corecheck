import { randomBytes, randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { addDays, dateInTimeZone } from '../common/clock.js';
import { StorageService } from '../common/storage.service.js';
import type { Env } from '../config/env.js';

/** The smallest valid PDF, standing in for a scanned certificate. */
const DEMO_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
);

const question = (id: string, text: string, overrides: object = {}) => ({
  id,
  text,
  type: 'yes_no',
  mandatory: true,
  failAnswer: 'no',
  min: null,
  max: null,
  meterTypeId: null,
  requireComment: 'on_fail',
  requirePhoto: 'never',
  offlineOnFail: false,
  defectSeverity: null,
  ...overrides,
});

/**
 * Milestone 2 demo data for an organisation that has none: plant
 * configuration, a published reception template and plant at each stage,
 * including a certificate close to expiry.
 */
export const seedPlant = async (
  manager: EntityManager,
  env: Env,
  orgId: string,
): Promise<void> => {
  const one = async (sql: string, params: unknown[]): Promise<string> => {
    const rows = (await manager.query(sql, params)) as Array<{ id: string }>;
    return rows[0]!.id;
  };
  const named = async (table: string, name: string) =>
    one(
      `insert into corecheck.${table} (org_id, name) values ($1, $2) returning id`,
      [orgId, name],
    );
  const [{ existing }] = (await manager.query(
    'select count(*)::int as existing from corecheck.plant_types where org_id = $1',
    [orgId],
  )) as [{ existing: number }];
  if (existing > 0) return;

  const [{ userId, timeZone }] = (await manager.query(
    `select u.id as "userId", o.time_zone as "timeZone"
       from corecheck.users u
       join corecheck.organisations o on o.id = u.org_id
       join corecheck.roles r on r.id = u.role_id
      where u.org_id = $1 and r.standard_key = 'admin'
      limit 1`,
    [orgId],
  )) as [{ userId: string; timeZone: string }];
  const sites = (await manager.query(
    'select id, name from corecheck.sites where org_id = $1',
    [orgId],
  )) as Array<{ id: string; name: string }>;
  const site = (name: string) => sites.find((s) => s.name === name)!.id;

  const excavator = await named('plant_types', 'Excavator');
  const crane = await named('plant_types', 'Mobile crane');
  const generator = await named('plant_types', 'Generator');
  const earthmoving = await named('plant_categories', 'Earthmoving');
  const lifting = await named('plant_categories', 'Lifting');
  const company = (kind: string, name: string) =>
    one(
      `insert into corecheck.plant_companies (org_id, kind, name)
       values ($1, $2, $3) returning id`,
      [orgId, kind, name],
    );
  const owner = await company('owner', 'Northwind Plant Ltd');
  const hire = await company('hire_company', 'Pennine Plant Hire');
  await manager.query(
    `insert into corecheck.meter_types (org_id, name, unit)
     values ($1, 'Hours', 'hrs'), ($1, 'Mileage', 'mi')`,
    [orgId],
  );
  const documentType = (name: string, hasExpiry: boolean) =>
    one(
      `insert into corecheck.document_types (org_id, name, has_expiry, warning_days)
       values ($1, $2, $3, 30) returning id`,
      [orgId, name, hasExpiry],
    );
  const loler = await documentType('LOLER certificate', true);
  await documentType('Insurance', true);
  await documentType('Operator manual', false);
  await manager.query(
    `insert into corecheck.plant_type_required_documents
       (org_id, plant_type_id, document_type_id) values ($1, $2, $3)`,
    [orgId, crane, loler],
  );

  const template = await one(
    `insert into corecheck.check_templates (org_id, purpose, name, created_by)
     values ($1, 'reception', 'Standard reception', $2) returning id`,
    [orgId, userId],
  );
  await manager.query(
    `insert into corecheck.check_template_versions
       (org_id, template_id, version, state, approval_mode, questions,
        published_at, published_by, created_by)
     values ($1, $2, 1, 'published', 'manual', $3::jsonb, now(), $4, $4)`,
    [
      orgId,
      template,
      JSON.stringify([
        question('condition', 'Is the plant in acceptable condition?', {
          offlineOnFail: true,
        }),
        question('guards', 'Are all guards and covers fitted?'),
      ]),
      userId,
    ],
  );

  const plant = (
    assetId: string,
    name: string,
    typeId: string,
    categoryId: string | null,
    ownership: 'owned' | 'hired',
    companyId: string,
    siteName: string,
    status: string,
    reason: string | null = null,
  ) =>
    one(
      `insert into corecheck.plants
         (org_id, asset_id, name, plant_type_id, category_id, ownership,
          company_id, site_id, status, restriction_reason, approved_at,
          approved_by, status_changed_by, qr_token, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               case when $9 = 'approved' then now() end,
               case when $9 = 'approved' then $11::uuid end,
               $11, $12, $11)
       returning id`,
      [
        orgId,
        assetId,
        name,
        typeId,
        categoryId,
        ownership,
        companyId,
        site(siteName),
        status,
        reason,
        userId,
        randomBytes(16).toString('base64url'),
      ],
    );
  const leeds = 'Leeds Depot';
  await plant(
    'PLT-000001',
    'Excavator EX-101',
    excavator,
    earthmoving,
    'owned',
    owner,
    leeds,
    'approved',
  );
  const liveCrane = await plant(
    'PLT-000002',
    'Mobile crane MC-2',
    crane,
    lifting,
    'hired',
    hire,
    leeds,
    'approved',
  );
  await plant(
    'PLT-000003',
    'Mobile crane MC-3',
    crane,
    lifting,
    'hired',
    hire,
    leeds,
    'pending_reception',
  );
  await plant(
    'PLT-000004',
    'Generator GN-14',
    generator,
    null,
    'owned',
    owner,
    'Manchester Yard',
    'restricted',
    'not_in_use',
  );
  await manager.query(
    `insert into corecheck.plant_asset_counters (org_id, next_value)
     values ($1, 5)
     on conflict (org_id) do update set next_value = 5`,
    [orgId],
  );

  // A verified LOLER certificate that is close to expiry.
  const documentId = await one(
    `insert into corecheck.plant_documents
       (org_id, plant_id, document_type_id, created_by)
     values ($1, $2, $3, $4) returning id`,
    [orgId, liveCrane, loler, userId],
  );
  const versionId = randomUUID();
  const storagePath = `${orgId}/plants/${liveCrane}/documents/${documentId}/${versionId}.pdf`;
  await new StorageService(env).put(storagePath, DEMO_PDF, 'application/pdf');
  const now = new Date();
  await manager.query(
    `insert into corecheck.plant_document_versions
       (id, org_id, document_id, version, reference, issued_on, expires_on,
        storage_path, file_name, content_type, size_bytes, uploaded_by,
        verification, verified_by, verified_at)
     values ($1, $2, $3, 1, 'LOLER-2041', $4, $5, $6, 'loler-mc-2.pdf',
             'application/pdf', $7, $8, 'verified', $8, now())`,
    [
      versionId,
      orgId,
      documentId,
      dateInTimeZone(addDays(now, -345), timeZone),
      dateInTimeZone(addDays(now, 20), timeZone),
      storagePath,
      DEMO_PDF.length,
      userId,
    ],
  );
  await manager.query(
    'update corecheck.plant_documents set current_version_id = $1 where id = $2',
    [versionId, documentId],
  );
};

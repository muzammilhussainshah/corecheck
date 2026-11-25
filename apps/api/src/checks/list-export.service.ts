import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import {
  CHECK_STATUS_LABELS,
  CHECK_SOURCE_LABELS,
  DEFECT_SEVERITY_LABELS,
  DEFECT_STATUS_LABELS,
  type listChecksQuerySchema,
  type listDefectsQuerySchema,
  TEMPLATE_PURPOSE_LABELS,
  VERIFICATION_STATE_LABELS,
} from '@corecheck/shared';
import { AuditService, userActor } from '../audit/audit.service.js';
import type { CustomerAuth } from '../auth/auth-context.js';
import { Clock, dateInTimeZone } from '../common/clock.js';
import { forbidden } from '../common/errors.js';
import { TenantDb } from '../database/db-context.js';
import { csvCell } from '../plants/plant-output.service.js';
import { ChecksService } from './checks.service.js';
import { DefectsService } from './defects.service.js';
import { assigneeLabel } from './labels.js';

/** The most rows one export holds. */
const LIMIT = 5000;
const PAGE = 100;

/**
 * CSV exports of the Checks and Defects lists, built from the same query,
 * filters and scope as the list on screen (LST-004), with formula-like text
 * neutralised. Exports are audited.
 */
@Injectable()
export class ListExportService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly checks: ChecksService,
    private readonly defects: DefectsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private csv(rows: string[][], name: string, auth: CustomerAuth) {
    const stamp = dateInTimeZone(this.clock.now(), auth.org.timeZone);
    const body = rows.map((cells) => cells.map(csvCell).join(',')).join('\r\n');
    return {
      body: Buffer.from(`\uFEFF${body}\r\n`, 'utf8'),
      filename: `${name}-${stamp}.csv`,
      contentType: 'text/csv; charset=utf-8',
    };
  }

  private when(iso: string | null, auth: CustomerAuth) {
    return iso
      ? new Intl.DateTimeFormat('en-GB', {
          timeZone: auth.org.timeZone,
          dateStyle: 'short',
          timeStyle: 'short',
        }).format(new Date(iso))
      : '';
  }

  async checksCsv(
    auth: CustomerAuth,
    query: z.output<typeof listChecksQuerySchema>,
  ) {
    if (!auth.permissions.has('reports.export')) throw forbidden();
    const rows: string[][] = [
      ['Check', 'Template', 'Purpose', 'Version', 'Source', 'Plant', 'Plant name', 'Site', 'Due', 'Assigned to', 'Status', 'Submitted', 'Completed', 'Needs review'],
    ];
    for (let page = 1; (page - 1) * PAGE < LIMIT; page += 1) {
      const result = await this.checks.list(auth, { ...query, page, pageSize: PAGE });
      for (const check of result.items)
        rows.push([
          check.ref,
          check.template.name,
          TEMPLATE_PURPOSE_LABELS[check.template.purpose],
          String(check.template.version),
          CHECK_SOURCE_LABELS[check.source],
          check.plant.assetId,
          check.plant.name,
          check.plant.site.name,
          check.dueOn ?? '',
          assigneeLabel(check.assignee),
          CHECK_STATUS_LABELS[check.displayStatus],
          this.when(check.submittedAt, auth),
          this.when(check.completedAt, auth),
          check.requiresReview ? 'Yes' : 'No',
        ]);
      if (page * PAGE >= result.total) break;
    }
    await this.record(auth, 'checks', rows.length - 1);
    return this.csv(rows, 'checks', auth);
  }

  async defectsCsv(
    auth: CustomerAuth,
    query: z.output<typeof listDefectsQuerySchema>,
  ) {
    if (!auth.permissions.has('reports.export')) throw forbidden();
    const rows: string[][] = [
      ['Defect', 'Severity', 'Status', 'Verification', 'Question', 'Plant', 'Plant name', 'Site', 'Raised by', 'Raised', 'Source', 'Assigned to', 'Keeps plant Offline'],
    ];
    for (let page = 1; (page - 1) * PAGE < LIMIT; page += 1) {
      const result = await this.defects.list(auth, { ...query, page, pageSize: PAGE });
      for (const defect of result.items)
        rows.push([
          defect.ref,
          DEFECT_SEVERITY_LABELS[defect.severity],
          DEFECT_STATUS_LABELS[defect.status],
          VERIFICATION_STATE_LABELS[defect.verification],
          defect.questionText,
          defect.plant.assetId,
          defect.plant.name,
          defect.plant.site.name,
          defect.raisedBy,
          this.when(defect.raisedAt, auth),
          defect.source.kind === 'check' ? (defect.source.ref ?? 'Check') : 'Reception',
          defect.assignee?.name ?? '',
          defect.restrictsPlant ? 'Yes' : 'No',
        ]);
      if (page * PAGE >= result.total) break;
    }
    await this.record(auth, 'defects', rows.length - 1);
    return this.csv(rows, 'defects', auth);
  }

  private record(auth: CustomerAuth, what: 'checks' | 'defects', count: number) {
    return this.audit.record(this.tenantDb.manager, {
      scope: 'tenant',
      orgId: auth.orgId,
      actor: userActor(auth),
      action: what === 'checks' ? 'check.exported' : 'defect.exported',
      entityType: `${what}_list`,
      summary: `Exported ${count} ${what} (CSV)`,
      metadata: { count },
    });
  }
}

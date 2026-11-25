import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  type AnswerValue,
  DEFECT_SEVERITY_LABELS,
  type TemplateQuestion,
} from '@corecheck/shared';
import { type AuditActor, AuditService } from '../audit/audit.service.js';
import { answerText } from '../common/answers.js';
import type { PlantEntity } from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PeopleService } from '../notifications/people.service.js';

export const defectRef = (refNo: number): string =>
  `DEF-${String(refNo).padStart(6, '0')}`;

export type DefectSource =
  | { kind: 'check'; id: string; ref: string }
  | { kind: 'reception'; id: string };

export interface RecordedAnswer {
  questionId: string;
  value: AnswerValue;
  comment: string | null;
  answeredBy: string;
}

/**
 * Raises Defects from recorded answers (FRD 13.1). Only a failed answer to a
 * question with a defect trigger raises one (DEF-002, DEF-AC-01, TMP-AC-04);
 * nobody can raise one by hand (DEF-003). An answer raises at most one, so
 * resubmitting a returned check never duplicates it.
 */
@Injectable()
export class DefectRaiser {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly people: PeopleService,
  ) {}

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  async raise(
    actor: AuditActor,
    plant: PlantEntity,
    source: DefectSource,
    failed: TemplateQuestion[],
    answers: ReadonlyMap<string, RecordedAnswer>,
  ): Promise<Array<{ id: string; ref: string }>> {
    const raised: Array<{ id: string; ref: string }> = [];
    for (const question of failed) {
      if (!question.defectSeverity) continue;
      const answer = answers.get(question.id);
      if (!answer) continue;
      const rows = (await this.db.query(
        `insert into corecheck.defects
           (org_id, plant_id, check_id, reception_check_id, question_id,
            question_text, answer, answer_comment, raised_by, severity,
            restricts_plant)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
         on conflict do nothing
         returning id, ref_no as "refNo"`,
        [
          this.tenantDb.orgId,
          plant.id,
          source.kind === 'check' ? source.id : null,
          source.kind === 'reception' ? source.id : null,
          question.id,
          question.text,
          JSON.stringify(answer.value),
          answer.comment,
          answer.answeredBy,
          question.defectSeverity,
          question.offlineOnFail,
        ],
      )) as Array<{ id: string; refNo: number }>;
      const row = rows[0];
      if (!row) continue;
      const ref = defectRef(row.refNo);
      const from =
        source.kind === 'check' ? source.ref : 'reception';
      const summary = `Raised ${ref} (${question.defectSeverity}) on ${plant.assetId}: ${question.text} — ${answerText(answer.value)}`;
      const metadata = {
        defectId: row.id,
        severity: question.defectSeverity,
        questionId: question.id,
        source: source.kind,
        sourceId: source.id,
      };
      await this.audit.record(this.db, {
        scope: 'tenant',
        orgId: this.tenantDb.orgId,
        actor,
        action: 'defect.raised',
        entityType: 'defect',
        entityId: row.id,
        summary: `${summary} (from ${from})`,
        metadata,
      });
      await this.audit.record(this.db, {
        scope: 'tenant',
        orgId: this.tenantDb.orgId,
        actor,
        action: 'defect.raised',
        entityType: 'plant',
        entityId: plant.id,
        summary,
        metadata,
      });
      await this.notifications.notify(
        await this.people.withPermission('defects.assign', plant.siteId),
        {
          kind: 'defect_raised',
          title: `${ref}: ${DEFECT_SEVERITY_LABELS[question.defectSeverity]} Defect on ${plant.assetId}`,
          body: `${question.text} — ${answerText(answer.value)}`,
          link: `/defects/${row.id}`,
          entityType: 'defect',
          entityId: row.id,
        },
        // Whoever recorded the answer already knows.
        [actor.id],
      );
      raised.push({ id: row.id, ref });
    }
    return raised;
  }
}

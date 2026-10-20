import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { z } from 'zod';
import {
  ERROR_CODES,
  type ErrorCode,
  type IdName,
  POC_MAX_EVIDENCE_BYTES,
  POC_QUESTIONS,
  type PocCheck,
  type PocCheckStatus,
  type pocEvidenceFieldsSchema,
  type PocEvidence,
  type PocMutation,
  type PocMutationResult,
  type PocPullResponse,
  type PocPushResponse,
  type PocQuestionKey,
} from '@corecheck/shared';
import { AuditService, userActor } from '../audit/audit.service.js';
import type { CustomerAuth } from '../auth/auth-context.js';
import { Clock } from '../common/clock.js';
import {
  conflict,
  fieldError,
  notFound,
  outOfScope,
} from '../common/errors.js';
import { type AppConfig, InjectConfig } from '../config/app-config.js';
import {
  PocAnswerEntity,
  PocCheckEntity,
  PocEvidenceEntity,
  PocMutationEntity,
} from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';
import { detectImageType, stripImageMetadata } from './image-sanitiser.js';

type EvidenceFields = z.output<typeof pocEvidenceFieldsSchema>;

interface CheckRow {
  id: string;
  title: string;
  plantLabel: string;
  siteId: string;
  siteName: string;
  status: PocCheckStatus;
  submittedById: string | null;
  submittedByName: string | null;
  submittedAt: Date | null;
  updatedAt: Date;
}

const CHECK_SELECT = /* sql */ `
  select c.id, c.title, c.plant_label as "plantLabel", c.site_id as "siteId",
         s.name as "siteName", c.status, c.submitted_by as "submittedById",
         nullif(concat_ws(' ', sb.first_name, sb.last_name), '') as "submittedByName",
         c.submitted_at as "submittedAt", c.updated_at as "updatedAt"
    from corecheck.poc_checks c
    join corecheck.sites s on s.id = c.site_id
    left join corecheck.users sb on sb.id = c.submitted_by`;

const rejected = (
  id: string,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): PocMutationResult => ({
  id,
  status: 'rejected',
  code,
  message,
  ...(details ? { details } : {}),
});

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

/**
 * The server half of the offline synchronisation proof of concept (FRD 21).
 *
 * - Pull returns every check the user may currently work on; the device
 *   deletes anything else, so revoked access disappears on the next sync
 *   (MOB-AC-03).
 * - Push applies queued mutations in order. Each carries a device-generated
 *   id; a replay returns the recorded outcome instead of applying twice.
 * - Submission is a conditional update from open to submitted, so the first
 *   valid submission wins and a later one is rejected with who submitted and
 *   when (MOB-006, MOB-007, CHK-007).
 */
@Injectable()
export class PocSyncService {
  private readonly storageRoot: string;

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @InjectConfig() config: AppConfig,
  ) {
    this.storageRoot = resolve(config.STORAGE_DIR);
  }

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  async pull(auth: CustomerAuth): Promise<PocPullResponse> {
    const scoped = auth.orgWideScope ? '' : 'where c.site_id = any($1::uuid[])';
    const rows = (await this.db.query(
      `${CHECK_SELECT} ${scoped} order by c.created_at, c.id`,
      auth.orgWideScope ? [] : [auth.siteIds],
    )) as CheckRow[];
    return {
      serverTime: this.clock.now().toISOString(),
      checks: await this.withDetails(rows),
    };
  }

  async createCheck(
    auth: CustomerAuth,
    input: { siteId: string; title: string; plantLabel: string },
  ): Promise<PocCheck> {
    if (!this.inScope(auth, input.siteId)) throw outOfScope();
    const site = (await this.db.query(
      'select id from corecheck.sites where id = $1 and archived_at is null',
      [input.siteId],
    )) as IdName[];
    if (site.length === 0) throw fieldError('siteId', 'Choose an active site.');
    const result = await this.db.insert(PocCheckEntity, {
      orgId: auth.orgId,
      siteId: input.siteId,
      title: input.title,
      plantLabel: input.plantLabel,
      status: 'open',
    });
    return this.getCheck(auth, (result.identifiers[0] as { id: string }).id);
  }

  async push(
    auth: CustomerAuth,
    mutations: PocMutation[],
  ): Promise<PocPushResponse> {
    const results: PocMutationResult[] = [];
    for (const mutation of mutations) {
      const previous = await this.db.findOneBy(PocMutationEntity, {
        id: mutation.id,
      });
      if (previous) {
        const original = previous.result as PocMutationResult;
        results.push(
          original.status === 'applied'
            ? { id: mutation.id, status: 'duplicate' }
            : original,
        );
        continue;
      }
      const result = await this.apply(auth, mutation);
      await this.db.query(
        `insert into corecheck.poc_mutations (id, org_id, user_id, result)
         values ($1, $2, $3, $4::jsonb)`,
        [mutation.id, auth.orgId, auth.userId, JSON.stringify(result)],
      );
      results.push(result);
    }
    return { results };
  }

  async uploadEvidence(
    auth: CustomerAuth,
    checkId: string,
    fields: EvidenceFields,
    file: { buffer: Buffer; size: number } | undefined,
  ): Promise<PocEvidence> {
    if (!file || file.size === 0) throw fieldError('file', 'Attach a photo.');
    if (file.size > POC_MAX_EVIDENCE_BYTES)
      throw fieldError('file', 'That photo is too large.');

    const existing = await this.db.findOneBy(PocEvidenceEntity, {
      id: fields.id,
    });
    if (existing)
      return this.toEvidence(
        existing,
        await this.userNames([existing.uploadedBy]),
      );

    const check = await this.lockCheck(checkId);
    if (!check || !this.inScope(auth, check.siteId))
      throw outOfScope('You no longer have access to this check.');
    if (check.status === 'submitted') {
      throw conflict(
        ERROR_CODES.ALREADY_SUBMITTED,
        'This check has already been submitted.',
      );
    }

    const type = detectImageType(file.buffer);
    if (!type) throw fieldError('file', 'Upload a JPEG or PNG photo.');
    let clean: Buffer;
    try {
      clean = stripImageMetadata(file.buffer, type);
    } catch {
      throw fieldError('file', 'That photo could not be read.');
    }

    const relativePath = join(
      'poc',
      auth.orgId,
      checkId,
      `${fields.id}.${type === 'image/jpeg' ? 'jpg' : 'png'}`,
    );
    const absolutePath = join(this.storageRoot, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, clean);

    await this.db.insert(PocEvidenceEntity, {
      id: fields.id,
      orgId: auth.orgId,
      checkId,
      questionKey: fields.questionKey,
      storagePath: relativePath,
      contentType: type,
      sizeBytes: clean.length,
      uploadedBy: auth.userId,
      capturedAt: new Date(fields.capturedAt),
    });
    const saved = await this.db.findOneByOrFail(PocEvidenceEntity, {
      id: fields.id,
    });
    return this.toEvidence(saved, await this.userNames([auth.userId]));
  }

  /** Where an evidence file is stored, after checking the caller may see it. */
  async evidenceFile(
    auth: CustomerAuth,
    evidenceId: string,
  ): Promise<{ path: string; contentType: string }> {
    const evidence = await this.db.findOneBy(PocEvidenceEntity, {
      id: evidenceId,
    });
    const check =
      evidence &&
      (await this.db.findOneBy(PocCheckEntity, { id: evidence.checkId }));
    if (!evidence || !check || !this.inScope(auth, check.siteId))
      throw notFound('Evidence');
    return {
      path: join(this.storageRoot, evidence.storagePath),
      contentType: evidence.contentType,
    };
  }

  // ------------------------------------------------------------- internals

  private inScope(auth: CustomerAuth, siteId: string): boolean {
    return auth.orgWideScope || auth.siteIds.includes(siteId);
  }

  private async lockCheck(id: string): Promise<CheckRow | null> {
    const [row] = (await this.db.query(
      `${CHECK_SELECT} where c.id = $1 for update of c`,
      [id],
    )) as CheckRow[];
    return row ?? null;
  }

  private async apply(
    auth: CustomerAuth,
    mutation: PocMutation,
  ): Promise<PocMutationResult> {
    const check = await this.lockCheck(mutation.checkId);
    if (!check || !this.inScope(auth, check.siteId)) {
      return rejected(
        mutation.id,
        ERROR_CODES.OUT_OF_SCOPE,
        'You no longer have access to this check.',
      );
    }

    if (check.status === 'submitted') {
      const who = check.submittedByName ?? 'another user';
      const when = iso(check.submittedAt);
      if (mutation.type === 'submit') {
        await this.record(
          auth,
          'poc.check.submission_rejected',
          check.id,
          `Later submission of "${check.title}" rejected; first submitted by ${who}`,
        );
      }
      return rejected(
        mutation.id,
        ERROR_CODES.ALREADY_SUBMITTED,
        mutation.type === 'submit'
          ? `This check was already submitted by ${who}. Your submission was not applied; the submitted record is unchanged.`
          : `This check was submitted by ${who} and can no longer be changed.`,
        { submittedBy: who, submittedAt: when },
      );
    }

    if (mutation.type === 'answer') {
      // Keep the most recent answer by device time, so an older offline edit
      // that arrives late cannot overwrite a newer one.
      await this.db.query(
        `insert into corecheck.poc_answers
           (org_id, check_id, question_key, value, answered_by, answered_at)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (check_id, question_key) do update
           set value = excluded.value, answered_by = excluded.answered_by,
               answered_at = excluded.answered_at, received_at = now()
         where corecheck.poc_answers.answered_at <= excluded.answered_at`,
        [
          auth.orgId,
          check.id,
          mutation.questionKey,
          mutation.value,
          auth.userId,
          mutation.answeredAt,
        ],
      );
      return { id: mutation.id, status: 'applied' };
    }

    const missing = await this.missingMandatory(check.id);
    if (missing.length > 0) {
      return rejected(
        mutation.id,
        ERROR_CODES.INCOMPLETE_SUBMISSION,
        `Answer every mandatory question before submitting: ${missing.join(', ')}.`,
        { missing },
      );
    }

    const updated = (await this.db.query(
      `update corecheck.poc_checks
          set status = 'submitted', submitted_by = $2, submitted_at = $3,
              submitted_on_device_at = $4
        where id = $1 and status = 'open'
        returning id`,
      [check.id, auth.userId, this.clock.now(), mutation.submittedAt],
    )) as [unknown[], number];
    if (updated[1] === 0) {
      return rejected(
        mutation.id,
        ERROR_CODES.ALREADY_SUBMITTED,
        'This check was already submitted.',
      );
    }
    await this.record(
      auth,
      'poc.check.submitted',
      check.id,
      `Submitted "${check.title}" (${check.plantLabel})`,
    );
    return { id: mutation.id, status: 'applied' };
  }

  private async missingMandatory(checkId: string): Promise<string[]> {
    const answered = new Set(
      (
        (await this.db.query(
          `select question_key as key from corecheck.poc_answers where check_id = $1 and value <> ''
         union
         select question_key from corecheck.poc_evidence where check_id = $1`,
          [checkId],
        )) as Array<{ key: PocQuestionKey }>
      ).map((row) => row.key),
    );
    return POC_QUESTIONS.filter((q) => q.mandatory && !answered.has(q.key)).map(
      (q) => q.label,
    );
  }

  private async getCheck(auth: CustomerAuth, id: string): Promise<PocCheck> {
    const rows = (await this.db.query(`${CHECK_SELECT} where c.id = $1`, [
      id,
    ])) as CheckRow[];
    const [check] = await this.withDetails(rows);
    if (!check || !this.inScope(auth, check.site.id)) throw notFound('Check');
    return check;
  }

  private async withDetails(rows: CheckRow[]): Promise<PocCheck[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const answers = await this.db.find(PocAnswerEntity, {
      where: ids.map((checkId) => ({ checkId })),
    });
    const evidence = await this.db.find(PocEvidenceEntity, {
      where: ids.map((checkId) => ({ checkId })),
    });
    const names = await this.userNames([
      ...answers.map((a) => a.answeredBy),
      ...evidence.map((e) => e.uploadedBy),
    ]);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      plantLabel: row.plantLabel,
      site: { id: row.siteId, name: row.siteName },
      status: row.status,
      submittedBy: row.submittedById
        ? { id: row.submittedById, name: row.submittedByName ?? '' }
        : null,
      submittedAt: iso(row.submittedAt),
      answers: answers
        .filter((a) => a.checkId === row.id)
        .map((a) => ({
          questionKey: a.questionKey,
          value: a.value,
          answeredBy: { id: a.answeredBy, name: names.get(a.answeredBy) ?? '' },
          answeredAt: a.answeredAt.toISOString(),
        })),
      evidence: evidence
        .filter((e) => e.checkId === row.id)
        .map((e) => this.toEvidence(e, names)),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  private toEvidence(
    evidence: PocEvidenceEntity,
    names: Map<string, string>,
  ): PocEvidence {
    return {
      id: evidence.id,
      questionKey: evidence.questionKey,
      uploadedBy: {
        id: evidence.uploadedBy,
        name: names.get(evidence.uploadedBy) ?? '',
      },
      capturedAt: evidence.capturedAt.toISOString(),
      contentType: evidence.contentType,
      sizeBytes: evidence.sizeBytes,
    };
  }

  private async userNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = (await this.db.query(
      `select id, first_name || ' ' || last_name as name from corecheck.users where id = any($1::uuid[])`,
      [unique],
    )) as IdName[];
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private record(
    auth: CustomerAuth,
    action: 'poc.check.submitted' | 'poc.check.submission_rejected',
    checkId: string,
    summary: string,
  ): Promise<void> {
    return this.audit.record(this.db, {
      scope: 'tenant',
      orgId: auth.orgId,
      actor: userActor(auth),
      action,
      entityType: 'poc_check',
      entityId: checkId,
      summary,
    });
  }
}

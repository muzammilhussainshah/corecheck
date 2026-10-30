import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { In } from 'typeorm';
import type {
  createMeterReadingSchema,
  MeterReading,
  PlantMeters,
  TemplateQuestion,
} from '@corecheck/shared';
import type { z } from 'zod';
import {
  type AuditActor,
  AuditService,
  userActor,
} from '../audit/audit.service.js';
import { type CustomerAuth, fullName } from '../auth/auth-context.js';
import { Clock } from '../common/clock.js';
import { fieldError, forbidden, notFound } from '../common/errors.js';
import {
  MeterReadingCorrectionEntity,
  MeterReadingEntity,
  MeterTypeEntity,
  type PlantEntity,
  type ReceptionAnswerEntity,
  UserEntity,
} from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';
import { PlantsService } from './plants.service.js';

type CreateInput = z.output<typeof createMeterReadingSchema>;

/**
 * Meter readings (FRD 14): recorded by hand or from a reception check, shown
 * as a dated history on the plant (MTR-006). Corrections keep the original
 * value, the reason, the person and the time (MTR-005).
 */
@Injectable()
export class MetersService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly plants: PlantsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  async forPlant(auth: CustomerAuth, plantId: string): Promise<PlantMeters> {
    const plant = await this.plants.loadVisible(auth, plantId);
    const rows = await this.db.find(MeterReadingEntity, {
      where: { plantId },
      order: { readAt: 'DESC', createdAt: 'DESC' },
    });
    const canCorrect = auth.permissions.has('meters.correct');
    const readings = await this.toReadings(rows, canCorrect);
    const latest = new Map<string, MeterReading>();
    for (const reading of readings)
      if (!latest.has(reading.meterType.id))
        latest.set(reading.meterType.id, reading);
    return {
      latest: [...latest.values()],
      readings,
      capabilities: {
        record: auth.permissions.has('meters.record') && !plant.archivedAt,
      },
    };
  }

  async record(
    auth: CustomerAuth,
    plantId: string,
    input: CreateInput,
  ): Promise<PlantMeters> {
    if (!auth.permissions.has('meters.record')) throw forbidden();
    const plant = await this.plants.loadVisible(auth, plantId);
    const meter = await this.db.findOneBy(MeterTypeEntity, {
      id: input.meterTypeId,
    });
    if (!meter) throw fieldError('meterTypeId', 'Meter type not found.');
    if (meter.archivedAt)
      throw fieldError('meterTypeId', `${meter.name} is archived.`);
    const readAt = input.readAt ? new Date(input.readAt) : this.clock.now();
    if (readAt.getTime() > this.clock.now().getTime() + 60_000)
      throw fieldError('readAt', 'The reading time cannot be in the future.');
    await this.db.insert(MeterReadingEntity, {
      orgId: this.tenantDb.orgId,
      plantId,
      meterTypeId: meter.id,
      value: String(input.value),
      unit: meter.unit,
      readAt,
      source: 'manual',
      recordedBy: auth.userId,
    });
    await this.record_(
      userActor(auth),
      plant,
      'meter.recorded',
      `Recorded ${meter.name} ${input.value} ${meter.unit} for ${plant.assetId}`,
    );
    return this.forPlant(auth, plantId);
  }

  /** Records the meter questions of a finished reception (MTR-003). */
  async recordFromReception(
    actor: AuditActor,
    plant: PlantEntity,
    checkId: string,
    questions: TemplateQuestion[],
    answers: ReceptionAnswerEntity[],
  ): Promise<void> {
    for (const question of questions) {
      if (question.type !== 'meter' || !question.meterTypeId) continue;
      const answer = answers.find((a) => a.questionId === question.id);
      if (typeof answer?.value !== 'number') continue;
      const exists = await this.db.findOneBy(MeterReadingEntity, {
        checkId,
        meterTypeId: question.meterTypeId,
      });
      if (exists) continue;
      const meter = await this.db.findOneByOrFail(MeterTypeEntity, {
        id: question.meterTypeId,
      });
      await this.db.insert(MeterReadingEntity, {
        orgId: this.tenantDb.orgId,
        plantId: plant.id,
        meterTypeId: meter.id,
        value: String(answer.value),
        unit: meter.unit,
        readAt: answer.answeredAt,
        source: 'reception',
        checkId,
        recordedBy: answer.answeredBy,
      });
      await this.record_(
        actor,
        plant,
        'meter.recorded',
        `Recorded ${meter.name} ${answer.value} ${meter.unit} for ${plant.assetId} from reception`,
      );
    }
  }

  async correct(
    auth: CustomerAuth,
    readingId: string,
    value: number,
    reason: string,
  ): Promise<PlantMeters> {
    if (!auth.permissions.has('meters.correct')) throw forbidden();
    const reading = await this.db.findOneBy(MeterReadingEntity, {
      id: readingId,
    });
    if (!reading) throw notFound('Reading');
    let plant: PlantEntity;
    try {
      plant = await this.plants.loadVisible(auth, reading.plantId);
    } catch {
      throw notFound('Reading');
    }
    if (Number(reading.value) === value)
      throw fieldError('value', 'Enter a different value.');
    await this.db.insert(MeterReadingCorrectionEntity, {
      orgId: this.tenantDb.orgId,
      readingId,
      previousValue: reading.value,
      newValue: String(value),
      reason,
      correctedBy: auth.userId,
    });
    await this.db.update(
      MeterReadingEntity,
      { id: readingId },
      { value: String(value) },
    );
    await this.record_(
      userActor(auth),
      plant,
      'meter.corrected',
      `Corrected a reading of ${plant.assetId} from ${Number(reading.value)} to ${value}`,
      { previousValue: Number(reading.value), value, reason },
    );
    return this.forPlant(auth, reading.plantId);
  }

  private async toReadings(
    rows: MeterReadingEntity[],
    canCorrect: boolean,
  ): Promise<MeterReading[]> {
    if (rows.length === 0) return [];
    const corrections = await this.db.find(MeterReadingCorrectionEntity, {
      where: { readingId: In(rows.map((row) => row.id)) },
      order: { correctedAt: 'DESC' },
    });
    const meters = await this.db.find(MeterTypeEntity);
    const users = await this.db.findBy(UserEntity, {
      id: In([
        ...new Set([
          ...rows.map((row) => row.recordedBy),
          ...corrections.map((item) => item.correctedBy),
        ]),
      ]),
    });
    const name = (id: string) => {
      const user = users.find((candidate) => candidate.id === id);
      return user ? fullName(user) : 'Unknown';
    };
    return rows.map((row) => {
      const meter = meters.find((item) => item.id === row.meterTypeId)!;
      return {
        id: row.id,
        meterType: { id: meter.id, name: meter.name },
        value: Number(row.value),
        unit: row.unit,
        readAt: row.readAt.toISOString(),
        source: row.source,
        recordedBy: name(row.recordedBy),
        corrections: corrections
          .filter((item) => item.readingId === row.id)
          .map((item) => ({
            previousValue: Number(item.previousValue),
            newValue: Number(item.newValue),
            reason: item.reason,
            correctedBy: name(item.correctedBy),
            correctedAt: item.correctedAt.toISOString(),
          })),
        canCorrect,
      };
    });
  }

  private record_(
    actor: AuditActor,
    plant: PlantEntity,
    action: 'meter.recorded' | 'meter.corrected',
    summary: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(this.db, {
      scope: 'tenant',
      orgId: this.tenantDb.orgId,
      actor,
      action,
      entityType: 'plant',
      entityId: plant.id,
      summary,
      metadata,
    });
  }
}

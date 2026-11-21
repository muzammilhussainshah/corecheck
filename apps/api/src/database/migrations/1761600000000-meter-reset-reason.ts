import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Milestone 2 bug 7: a reading lower than the meter's latest is accepted
 * only with a reason (a replaced or reset meter), kept with the reading so
 * the history shows why the meter went down.
 */
const UP = /* sql */ `
alter table corecheck.meter_readings
  add column reset_reason text
    check (reset_reason is null or length(btrim(reset_reason)) between 1 and 500);
`;

const DOWN = /* sql */ `
alter table corecheck.meter_readings drop column reset_reason;
`;

export class MeterResetReason1761600000000 implements MigrationInterface {
  name = 'MeterResetReason1761600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(DOWN);
  }
}

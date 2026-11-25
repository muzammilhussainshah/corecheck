import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { type AppConfig, InjectConfig } from '../config/app-config.js';
import { enterTenantRole, runInTenantContext } from '../database/db-context.js';
import { SCHEDULE_ACTOR, SchedulesService } from './schedules.service.js';

const NO_USER = '00000000-0000-0000-0000-000000000000';
/** Key of the session lock that keeps two API instances from both running. */
const SWEEP_LOCK = 761_700;

export interface SweepResult {
  generated: number;
  due: number;
  overdue: number;
}

/**
 * Runs the schedules (FRD 11) every SCHEDULE_SWEEP_MINUTES: generates the
 * next check of each schedule, makes scheduled checks Due when their window
 * opens in the organisation's time zone (SCH-006), and tells people about
 * overdue work once (SCH-007, SCH-008). Organisation by organisation, each in
 * its own transaction under row-level security.
 */
@Injectable()
export class ScheduleSweepService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ScheduleSweepService.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly schedules: SchedulesService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    const minutes = this.config.SCHEDULE_SWEEP_MINUTES;
    if (minutes === 0) return;
    const run = () =>
      void this.sweep().catch((error: unknown) =>
        this.logger.error(`Schedule run failed: ${String(error)}`),
      );
    this.timers = [setTimeout(run, 20_000), setInterval(run, minutes * 60_000)];
    for (const timer of this.timers) timer.unref();
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
  }

  async sweep(): Promise<SweepResult> {
    const total: SweepResult = { generated: 0, due: 0, overdue: 0 };
    if (this.running) return total;
    this.running = true;
    const runner = this.dataSource.createQueryRunner();
    try {
      await runner.connect();
      const [{ locked }] = (await runner.query(
        'select pg_try_advisory_lock($1) as locked',
        [SWEEP_LOCK],
      )) as [{ locked: boolean }];
      if (!locked) return total;
      try {
        const orgs = (await runner.query(
          `select id from corecheck.organisations where status = 'active'`,
        )) as Array<{ id: string }>;
        for (const { id } of orgs) {
          try {
            const result = await this.sweepOrg(id);
            total.generated += result.generated;
            total.due += result.due;
            total.overdue += result.overdue;
          } catch (error) {
            // One organisation's failure must not stop the others.
            this.logger.error(`Schedule run failed for ${id}: ${String(error)}`);
          }
        }
        return total;
      } finally {
        await runner.query('select pg_advisory_unlock($1)', [SWEEP_LOCK]);
      }
    } finally {
      await runner.release();
      this.running = false;
    }
  }

  /** One organisation's run; tests call it directly. */
  sweepOrg(orgId: string): Promise<SweepResult> {
    return this.dataSource.transaction(async (manager) => {
      await enterTenantRole(manager, orgId, NO_USER);
      return runInTenantContext({ manager, orgId, userId: NO_USER }, async () => {
        const generated = await this.schedules.generate(SCHEDULE_ACTOR);
        const due = await this.schedules.makeDue();
        const overdue = await this.schedules.flagOverdue();
        return { generated, due, overdue };
      });
    });
  }
}

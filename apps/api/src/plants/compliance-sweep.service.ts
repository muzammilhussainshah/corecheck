import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuditActor } from '../audit/audit.service.js';
import { type AppConfig, InjectConfig } from '../config/app-config.js';
import { enterTenantRole, runInTenantContext } from '../database/db-context.js';
import { ComplianceService } from './compliance.service.js';

/** Recorded as the actor of restrictions the schedule applies. */
export const SWEEP_ACTOR: AuditActor = {
  type: 'system',
  id: null,
  name: 'Document expiry check',
};

const NO_USER = '00000000-0000-0000-0000-000000000000';
/** Key of the session lock that keeps two API instances from both sweeping. */
const SWEEP_LOCK = 760_900;

/**
 * Restricts approved plant whose mandatory documents have expired since
 * anyone last touched them (DOC-AC-01). Runs shortly after start-up and then
 * every COMPLIANCE_SWEEP_MINUTES, organisation by organisation, each in its
 * own transaction under row-level security like a customer request.
 */
@Injectable()
export class ComplianceSweepService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ComplianceSweepService.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly compliance: ComplianceService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    const minutes = this.config.COMPLIANCE_SWEEP_MINUTES;
    if (minutes === 0) return;
    const run = () =>
      void this.sweep().catch((error: unknown) =>
        this.logger.error(`Document expiry check failed: ${String(error)}`),
      );
    this.timers = [setTimeout(run, 30_000), setInterval(run, minutes * 60_000)];
    for (const timer of this.timers) timer.unref();
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
  }

  /** One pass over every active organisation; returns plant restricted. */
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    const runner = this.dataSource.createQueryRunner();
    try {
      await runner.connect();
      const [{ locked }] = (await runner.query(
        'select pg_try_advisory_lock($1) as locked',
        [SWEEP_LOCK],
      )) as [{ locked: boolean }];
      if (!locked) return 0;
      try {
        const orgs = (await runner.query(
          `select id from corecheck.organisations where status = 'active'`,
        )) as Array<{ id: string }>;
        let restricted = 0;
        for (const { id } of orgs) restricted += await this.sweepOrg(id);
        if (restricted > 0)
          this.logger.log(
            `Restricted ${restricted} plant with expired documents.`,
          );
        return restricted;
      } finally {
        await runner.query('select pg_advisory_unlock($1)', [SWEEP_LOCK]);
      }
    } finally {
      await runner.release();
      this.running = false;
    }
  }

  private sweepOrg(orgId: string): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      await enterTenantRole(manager, orgId, NO_USER);
      return runInTenantContext({ manager, orgId, userId: NO_USER }, () =>
        this.compliance.enforce(SWEEP_ACTOR),
      );
    });
  }
}

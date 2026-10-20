import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

/**
 * Three ways to reach the database, each with a deliberate privilege level:
 *
 * - TenantDb: the current customer request's transaction, running as
 *   corecheck_app with the organisation and user set. Row-level security
 *   confines every statement to that organisation.
 * - PlatformDb: internal staff work, running as corecheck_platform, which has
 *   no privileges on customer tables at all.
 * - SystemDb: the table owner, which bypasses row-level security. Reserved
 *   for sign-in, session checks and provisioning, where no organisation is
 *   known yet or a new one is being created.
 */

interface TenantStore {
  manager: EntityManager;
  orgId: string;
  userId: string;
}

const tenantStorage = new AsyncLocalStorage<TenantStore>();

/** Switches the transaction to the customer role and organisation. */
export const enterTenantRole = async (
  manager: EntityManager,
  orgId: string,
  userId: string,
): Promise<void> => {
  await manager.query(
    `select set_config('role', 'corecheck_app', true),
            set_config('corecheck.org_id', $1, true),
            set_config('corecheck.user_id', $2, true)`,
    [orgId, userId],
  );
};

/** Runs work inside a tenant transaction and exposes it through TenantDb. */
export const runInTenantContext = <T>(
  store: TenantStore,
  work: () => Promise<T>,
): Promise<T> => tenantStorage.run(store, work);

@Injectable()
export class TenantDb {
  private get store(): TenantStore {
    const store = tenantStorage.getStore();
    if (!store) {
      throw new Error(
        'No tenant database context: this code must run inside an authenticated customer request.',
      );
    }
    return store;
  }

  get manager(): EntityManager {
    return this.store.manager;
  }

  get orgId(): string {
    return this.store.orgId;
  }

  get userId(): string {
    return this.store.userId;
  }
}

@Injectable()
export class PlatformDb {
  constructor(private readonly dataSource: DataSource) {}

  /** Runs work as corecheck_platform: platform tables only. */
  transaction<T>(
    staffId: string,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `select set_config('role', 'corecheck_platform', true),
                set_config('corecheck.staff_id', $1, true)`,
        [staffId],
      );
      return work(manager);
    });
  }
}

@Injectable()
export class SystemDb {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Runs work as the table owner, bypassing row-level security. Use only for
   * authentication, sessions and provisioning — never to serve customer data
   * to a request.
   */
  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  get manager(): EntityManager {
    return this.dataSource.manager;
  }
}

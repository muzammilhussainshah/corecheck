import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { In, IsNull } from 'typeorm';
import type { NotificationKind, NotificationList } from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { Clock } from '../common/clock.js';
import { notFound } from '../common/errors.js';
import { NotificationEntity } from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';

export interface NotificationInput {
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string;
  entityType?: string;
  entityId?: string;
}

/**
 * In-app notifications (NTF-002, in-app channel). They are written in the
 * same transaction as the event, so a notification never announces work that
 * was rolled back. Email and push delivery come with the notifications
 * milestone; the records here are what they will send.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly clock: Clock,
  ) {}

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  async notify(
    userIds: Iterable<string>,
    input: NotificationInput,
    except: Array<string | null | undefined> = [],
  ): Promise<number> {
    const skip = new Set(except.filter(Boolean));
    const recipients = [...new Set(userIds)].filter((id) => !skip.has(id));
    if (recipients.length === 0) return 0;
    await this.db.insert(
      NotificationEntity,
      recipients.map((userId) => ({
        orgId: this.tenantDb.orgId,
        userId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        link: input.link ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
      })),
    );
    return recipients.length;
  }

  async list(auth: CustomerAuth): Promise<NotificationList> {
    const items = await this.db.find(NotificationEntity, {
      where: { userId: auth.userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    const unread = await this.db.countBy(NotificationEntity, {
      userId: auth.userId,
      readAt: IsNull(),
    });
    return {
      unread,
      items: items.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        body: item.body,
        link: item.link,
        createdAt: item.createdAt.toISOString(),
        readAt: item.readAt?.toISOString() ?? null,
      })),
    };
  }

  async markRead(
    auth: CustomerAuth,
    ids: string[] | 'all',
  ): Promise<NotificationList> {
    if (ids !== 'all') {
      const mine = await this.db.countBy(NotificationEntity, {
        id: In(ids),
        userId: auth.userId,
      });
      if (mine !== ids.length) throw notFound('Notification');
    }
    await this.db.update(
      NotificationEntity,
      {
        userId: auth.userId,
        readAt: IsNull(),
        ...(ids !== 'all' && { id: In(ids) }),
      },
      { readAt: this.clock.now() },
    );
    return this.list(auth);
  }
}

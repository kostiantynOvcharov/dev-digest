import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { NotificationRow } from '../../db/rows.js';
import { renderMarkdown } from '../../adapters/codeindex/ripgrep.js';
import type { CreateNotificationInput } from './service.js';

export type { NotificationRow };

/**
 * N1 — notifications data-access. Owns the `notifications` table.
 */
export class NotificationsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<NotificationRow[]> {
    return this.db
      .select()
      .from(t.notifications)
      .where(eq(t.notifications.workspaceId, workspaceId))
      .orderBy(desc(t.notifications.createdAt));
  }

  async getById(
    workspaceId: string,
    id: string,
  ): Promise<NotificationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.notifications)
      .where(
        and(
          eq(t.notifications.workspaceId, workspaceId),
          eq(t.notifications.id, id),
        ),
      );
    return row;
  }

  async insert(
    workspaceId: string,
    input: CreateNotificationInput,
    userId: string,
  ): Promise<NotificationRow> {
    const [row] = await this.db
      .insert(t.notifications)
      .values({
        workspaceId,
        title: input.title,
        body: renderMarkdown(input.body),
        level: input.level,
        createdBy: userId,
      })
      .returning();
    return row;
  }

  async deleteById(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.notifications)
      .where(eq(t.notifications.id, id))
      .returning({ id: t.notifications.id });
    return rows.length > 0;
  }
}

import type { Notification } from '@devdigest/shared';
import type { NotificationRow } from '../../db/rows.js';

/** N1 — pure transforms. No I/O. */
export function toNotificationDto(row: NotificationRow): Notification {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    level: row.level,
    read: row.read,
    created_at: row.createdAt.toISOString(),
  };
}

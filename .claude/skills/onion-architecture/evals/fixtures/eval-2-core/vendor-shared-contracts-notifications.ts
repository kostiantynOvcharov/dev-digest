// server/src/vendor/shared/contracts/notifications.ts
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { notifications } from '../../../db/schema.js';

export const NotificationLevel = z.enum(['info', 'warning', 'critical']);

export const Notification = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  level: NotificationLevel,
  read: z.boolean(),
  created_at: z.string(),
});
export type Notification = z.infer<typeof Notification>;

/** The row shape as stored, derived from the Drizzle table. */
export type NotificationRow = typeof notifications.$inferSelect;

export interface NotificationInput {
  title: string;
  body: string;
  level: 'info' | 'warning' | 'critical';
}

export function notificationFromRequest(req: FastifyRequest): NotificationInput {
  const body = req.body as Record<string, unknown>;
  return {
    title: String(body.title ?? ''),
    body: String(body.body ?? ''),
    level: (body.level as NotificationInput['level']) ?? 'info',
  };
}

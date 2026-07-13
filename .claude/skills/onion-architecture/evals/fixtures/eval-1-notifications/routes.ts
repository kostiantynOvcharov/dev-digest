import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { NotificationsService } from './service.js';

const CreateNotificationBody = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  level: z.enum(['info', 'warning', 'critical']),
});

const MarkReadBody = z.object({
  read: z.boolean(),
});

/**
 * N1 — notifications module.
 *   GET    /notifications          → list for the current workspace (newest first)
 *   POST   /notifications          → create a notification
 *   GET    /notifications/:id      → one notification
 *   PATCH  /notifications/:id/read → toggle the read flag
 */
export default async function notificationsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new NotificationsService(app.container);

  app.get('/notifications', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const rows = await app.container.db
      .select()
      .from(t.notifications)
      .where(eq(t.notifications.workspaceId, workspaceId))
      .orderBy(desc(t.notifications.createdAt));
    return rows;
  });

  app.post(
    '/notifications',
    { schema: { body: CreateNotificationBody } },
    async (req, reply) => {
      const { workspaceId, userId } = await getContext(app.container, req);
      const created = await service.create(workspaceId, req.body, userId);
      reply.status(201);
      return created;
    },
  );

  app.get(
    '/notifications/:id',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const n = await service.getById(workspaceId, req.params.id);
      if (!n) throw new NotFoundError('notification not found');
      return n;
    },
  );

  app.patch(
    '/notifications/:id/read',
    { schema: { params: IdParams, body: MarkReadBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const [row] = await app.container.db
        .update(t.notifications)
        .set({ read: req.body.read })
        .where(
          and(
            eq(t.notifications.workspaceId, workspaceId),
            eq(t.notifications.id, req.params.id),
          ),
        )
        .returning();
      if (!row) throw new NotFoundError('notification not found');
      return row;
    },
  );
}

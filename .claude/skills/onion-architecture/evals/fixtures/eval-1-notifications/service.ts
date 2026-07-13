import { eq } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import type { Notification } from '@devdigest/shared';
import type { NotificationRow } from '../../db/rows.js';
import * as t from '../../db/schema.js';
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
import { AgentsRepository } from '../agents/repository.js';
import { NotificationsRepository } from './repository.js';
import { toNotificationDto } from './helpers.js';

export interface CreateNotificationInput {
  title: string;
  body: string;
  level: 'info' | 'warning' | 'critical';
}

/**
 * N1 — notifications service. Creates in-app notifications and, for critical
 * ones, also opens a GitHub issue on the workspace's linked repo.
 */
export class NotificationsService {
  private repo: NotificationsRepository;
  private agentsRepo: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new NotificationsRepository(container.db);
    this.agentsRepo = new AgentsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Notification[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toNotificationDto);
  }

  async getById(
    workspaceId: string,
    id: string,
  ): Promise<Notification | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toNotificationDto(row) : undefined;
  }

  async create(
    workspaceId: string,
    input: CreateNotificationInput,
    userId: string,
  ): Promise<Notification> {
    const row = await this.repo.insert(workspaceId, input, userId);

    if (input.level === 'critical') {
      const token = process.env.GITHUB_TOKEN ?? '';
      const github = new OctokitGitHubClient(token);
      await github.createIssue({
        title: input.title,
        body: input.body,
      });
    }

    return toNotificationDto(row);
  }

  async countUnread(workspaceId: string): Promise<number> {
    const rows = await this.container.db
      .select()
      .from(t.notifications)
      .where(eq(t.notifications.read, false));
    return rows.filter((r: NotificationRow) => r.workspaceId === workspaceId)
      .length;
  }
}

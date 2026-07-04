import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DevDigestClient } from '../http-client.js';
import { getBlastRadiusShape, type GetBlastRadiusInput } from '../schemas.js';
import { toolOk, guard } from '../format.js';

/**
 * Blast radius (impact map) of a PR: changed symbols → callers → impacted
 * endpoints/crons. Reads the pre-built repo-intel index via the API route
 * `GET /pulls/:id/blast` (no model call). `status: 'none'` means the repo isn't
 * indexed yet, so the map is empty — resync/clone the repo to populate it.
 *
 * Local DTO on purpose: this package never imports `@devdigest/shared` (see
 * format.ts) — it mirrors the `BlastRadiusResponse` contract shape instead.
 */
interface BlastResponseDto {
  status: 'full' | 'partial' | 'degraded' | 'failed' | 'none';
  degraded: boolean;
  reason: string | null;
  counts: { symbols: number; callers: number; endpoints: number; crons: number };
  changed_symbols: { name: string; file: string; kind: string }[];
  downstream: {
    symbol: string;
    callers: { name: string; file: string; line: number }[];
    endpoints_affected: string[];
    crons_affected: string[];
  }[];
  prior_prs: { id: string; number: number; title: string; opened_at: string | null; status: string }[];
  summary: string;
}

export function registerGetBlastRadius(server: McpServer, client: DevDigestClient): void {
  server.registerTool(
    'get_blast_radius',
    {
      description:
        'Get the blast radius (impact map) of a pull request — changed symbols, callers, ' +
        'impacted endpoints, and cron jobs. Read from the repo-intel index (no model call).',
      inputSchema: getBlastRadiusShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard<GetBlastRadiusInput>(async ({ pr_id }) => {
      const blast = await client.get<BlastResponseDto>(`/pulls/${pr_id}/blast`);
      return toolOk({
        status: blast.status,
        degraded: blast.degraded,
        reason: blast.reason,
        counts: blast.counts,
        changed_symbols: blast.changed_symbols,
        downstream: blast.downstream,
        prior_prs: blast.prior_prs,
        summary:
          blast.status === 'none'
            ? "No blast radius: this PR's repo is not indexed yet. Resync/clone the repo to build the repo-intel index."
            : blast.summary,
      });
    }),
  );
}

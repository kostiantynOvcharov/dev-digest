/**
 * Concise-output helpers. Tools return only the fields the model needs — never a
 * raw dump (one full review payload can burn tens of thousands of tokens) — and
 * large finding sets are truncated with an explicit flag.
 *
 * SECURITY: findings/conventions text is LLM-derived analysis of UNTRUSTED PR
 * code. It is returned here as opaque data (JSON), never interpolated into any
 * executed context, and length-capped to bound token cost.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ---- Inbound API shapes -----------------------------------------------------
// We model only the fields we consume with narrow local types. (We deliberately
// do NOT import @devdigest/shared: pulling its source across the tsconfig alias
// drags the whole contract graph into this package's build — see the plan's
// "runtime path alias" risk. Local types keep the package standalone.)

/** Subset of the /agents response we use. */
export interface ApiAgent {
  id: string;
  name: string;
  description: string;
  provider: string;
  model: string;
  enabled: boolean;
}

/** Subset of a /pulls/:id/runs RunSummary row we use. */
export interface ApiRunSummary {
  run_id: string;
  status: string | null;
  error: string | null;
}

export interface ApiFinding {
  file: string;
  start_line: number;
  end_line: number;
  severity: string;
  category: string;
  title: string;
  suggestion?: string | null;
}

export interface ReviewDto {
  id: string;
  agent_id: string | null;
  agent_name?: string | null;
  run_id: string | null;
  verdict: string | null;
  summary: string | null;
  score: number | null;
  created_at: string;
  findings: ApiFinding[];
}

export interface ConventionDto {
  rule: string;
  category: string | null;
  evidence_path: string | null;
  confidence: number;
  status: 'pending' | 'accepted' | 'rejected';
}

/** A PR reference as returned by GET /repos/:id/pulls (id is nullish). */
export interface PrRef {
  id?: string | null;
  number: number;
}

/** A run row as started by POST /pulls/:id/review. */
export interface StartedRun {
  run_id: string;
  agent_id: string | null;
}

// ---- Caps -------------------------------------------------------------------
const MAX_FINDINGS = 50;
const MAX_TITLE = 300;
const MAX_SUGGESTION = 600;

// ---- Compact shapes ---------------------------------------------------------
export interface CompactAgent {
  id: string;
  name: string;
  description: string;
  provider: string;
  model: string;
  enabled: boolean;
}

export interface CompactFinding {
  file: string;
  start_line: number;
  end_line: number;
  severity: string;
  category: string;
  title: string;
  suggestion?: string;
}

export interface CompactReview {
  agent_id: string | null;
  agent_name: string | null;
  run_id: string | null;
  verdict: string | null;
  score: number | null;
  findings: CompactFinding[];
  findings_total: number;
  truncated: boolean;
}

export interface CompactConvention {
  rule: string;
  category: string | null;
  evidence_path: string | null;
  confidence: number;
  status: string;
}

// ---- Mappers ----------------------------------------------------------------
export function toCompactAgents(agents: ApiAgent[]): CompactAgent[] {
  return agents.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    provider: a.provider,
    model: a.model,
    enabled: a.enabled,
  }));
}

export function toCompactReview(review: ReviewDto): CompactReview {
  const total = review.findings.length;
  const findings = review.findings.slice(0, MAX_FINDINGS).map(toCompactFinding);
  return {
    agent_id: review.agent_id,
    agent_name: review.agent_name ?? null,
    run_id: review.run_id,
    verdict: review.verdict,
    score: review.score,
    findings,
    findings_total: total,
    truncated: total > findings.length,
  };
}

function toCompactFinding(f: ApiFinding): CompactFinding {
  const out: CompactFinding = {
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    severity: f.severity,
    category: f.category,
    title: cap(f.title, MAX_TITLE),
  };
  if (f.suggestion) out.suggestion = cap(f.suggestion, MAX_SUGGESTION);
  return out;
}

export function toCompactConventions(rows: ConventionDto[]): CompactConvention[] {
  return rows.map((c) => ({
    rule: c.rule,
    category: c.category,
    evidence_path: c.evidence_path,
    confidence: c.confidence,
    status: c.status,
  }));
}

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ---- Tool result helpers ----------------------------------------------------
/** Success: compact JSON as text (for the model) + typed structuredContent. */
export function toolOk(data: object): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data as { [k: string]: unknown },
  };
}

/** Forward-leading error surfaced to the model (not a protocol error). */
export function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Wrap a handler so any thrown ApiError/Error becomes a forward-leading result. */
export function guard<A>(
  fn: (args: A) => Promise<CallToolResult>,
): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  };
}

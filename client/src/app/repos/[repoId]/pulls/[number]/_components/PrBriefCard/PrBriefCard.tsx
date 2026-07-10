"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Card,
  SectionLabel,
  Button,
  Badge,
  Icon,
  Skeleton,
  MonoLink,
  SelectInput,
  type IconName,
} from "@devdigest/ui";
import type { Brief, Risk, ReviewFocusItem, RiskSeverity } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { formatCost } from "@/lib/cost";
import { usePrBrief, useGenerateBrief } from "@/lib/hooks/brief";
import { useAgents } from "@/lib/hooks/agents";

interface PrBriefCardProps {
  prId: string | null;
  /** owner/repo for github deep-links; null until the repo loads. */
  repoFullName: string | null;
  /** PR head sha — pins file/line links to the right lines. */
  headSha: string | null;
}

/**
 * Why+Risk Brief card (Overview tab) — synthesizes the reviewer's opening
 * questions ("what is this PR, why, how risky, what do I read first?") from the
 * deterministic inputs, in ONE cached LLM call. Empty state offers Generate;
 * populated shows what/why, the overall risk level (color AND text label — never
 * color alone, AC-17), each risk with its grounded file/endpoint refs, and the
 * "read these first" locations. An agent-picker seeds the synthesis with that
 * agent's attached specs (D6). Mirrors `IntentCard`.
 */
export function PrBriefCard({ prId, repoFullName, headSha }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const { data, isLoading } = usePrBrief(prId);
  const generate = useGenerateBrief(prId);
  const { data: agents } = useAgents();
  const [agentId, setAgentId] = React.useState<string>("");

  if (!prId) return null;

  const brief = data?.brief ?? null;
  const outdated = data?.outdated ?? false;

  const runGenerate = () => generate.mutate(agentId || null);

  const agentOptions = [
    { value: "", label: t("specsNone") },
    ...(agents ?? []).map((a) => ({ value: a.id, label: a.name })),
  ];

  const generateBtn = (
    <Button
      kind="ghost"
      size="sm"
      icon="RefreshCw"
      loading={generate.isPending}
      disabled={generate.isPending}
      onClick={runGenerate}
    >
      {brief ? t("regenerate") : t("generate")}
    </Button>
  );

  const outdatedBadge = outdated ? (
    <span aria-label={t("outdatedAria")}>
      <Badge icon="AlertTriangle" color="var(--warn)" bg="transparent">
        {t("outdated")}
      </Badge>
    </span>
  ) : null;

  return (
    <section>
      <Card>
        <SectionLabel
          icon="FileText"
          right={
            <div style={st.headerRight}>
              {outdatedBadge}
              {generateBtn}
            </div>
          }
        >
          {t("title")}
        </SectionLabel>

        {isLoading && !brief ? (
          <Skeleton height={160} />
        ) : !brief ? (
          <div style={st.empty}>
            <div style={st.emptyIcon}>
              <Icon.FileText size={22} />
            </div>
            <div style={st.emptyTitle}>{t("emptyTitle")}</div>
            <div style={st.emptyBody}>{t("emptyBody")}</div>
            <Button
              kind="secondary"
              icon="Sparkles"
              loading={generate.isPending}
              disabled={generate.isPending}
              onClick={runGenerate}
            >
              {t("generate")}
            </Button>
          </div>
        ) : (
          <BriefBody brief={brief} data={data!} repoFullName={repoFullName} headSha={headSha} />
        )}

        {generate.isPending && (
          <div role="status" aria-live="polite" style={st.srOnly}>
            {t("generating")}
          </div>
        )}

        <div style={st.picker}>
          <span style={st.pickerLabel}>{t("specsSource")}</span>
          <div style={st.pickerControl}>
            <SelectInput value={agentId} onChange={setAgentId} options={agentOptions} mono={false} />
          </div>
        </div>
      </Card>
    </section>
  );
}

/** Populated brief: risk level + what/why + risks + review-focus + cost row. */
function BriefBody({
  brief,
  data,
  repoFullName,
  headSha,
}: {
  brief: Brief;
  data: NonNullable<ReturnType<typeof usePrBrief>["data"]>;
  repoFullName: string | null;
  headSha: string | null;
}) {
  const t = useTranslations("brief");
  const rs = RISK_STYLE[brief.risk_level];
  const levelLabel = t(RISK_LABEL_KEY[brief.risk_level]);

  return (
    <>
      <span aria-label={t("riskLevel", { level: levelLabel })} style={st.riskWrap}>
        <Badge icon={rs.icon} color={rs.color} bg={rs.bg}>
          {t("riskLevel", { level: levelLabel })}
        </Badge>
      </span>

      <p style={st.what}>{brief.what}</p>
      {brief.why && (
        <div style={st.whyRow}>
          <span style={st.whyLabel}>{t("whyLabel")}</span>
          <span style={st.whyText}>{brief.why}</span>
        </div>
      )}

      <div style={st.section}>
        <div style={st.subHeader}>{t("risksHeader")}</div>
        {brief.risks.length === 0 ? (
          <div style={st.none}>{t("noRisks")}</div>
        ) : (
          <ul style={st.list}>
            {brief.risks.map((risk, i) => (
              <RiskRow
                key={`${risk.title}-${i}`}
                risk={risk}
                repoFullName={repoFullName}
                headSha={headSha}
              />
            ))}
          </ul>
        )}
      </div>

      <div style={st.section}>
        <div style={st.subHeader}>{t("reviewFocus")}</div>
        {brief.review_focus.length === 0 ? (
          <div style={st.none}>{t("noRisks")}</div>
        ) : (
          <ol style={st.list}>
            {brief.review_focus.map((item, i) => (
              <ReviewFocusRow
                key={`${item.file}-${item.line ?? "x"}-${i}`}
                item={item}
                repoFullName={repoFullName}
                headSha={headSha}
              />
            ))}
          </ol>
        )}
      </div>

      <CostRow model={data.model} cost={data.cost} tokens={data.tokens} />
    </>
  );
}

/** One risk: severity badge + title + explanation + its file/endpoint refs. */
function RiskRow({
  risk,
  repoFullName,
  headSha,
}: {
  risk: Risk;
  repoFullName: string | null;
  headSha: string | null;
}) {
  const rs = RISK_STYLE[risk.severity];
  const I = Icon[rs.icon];
  return (
    <li style={st.riskItem}>
      <div style={st.riskHead}>
        <I size={13} style={{ color: rs.color, flexShrink: 0, marginTop: 2 }} />
        <span style={st.riskTitle}>{risk.title}</span>
        <Badge icon={rs.icon} color={rs.color} bg={rs.bg}>
          {rs.label}
        </Badge>
      </div>
      <p style={st.riskExpl}>{risk.explanation}</p>
      {risk.file_refs.length > 0 && (
        <div style={st.refs}>
          {risk.file_refs.map((ref, i) => (
            <RiskRef key={`${ref}-${i}`} refStr={ref} repoFullName={repoFullName} headSha={headSha} />
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * Render a risk ref BY TYPE: a file-path ref (has a "/" and a file extension)
 * → a clickable file link; an endpoint-shaped ref (e.g. `POST /api/x`) → a
 * NON-clickable labeled chip with an endpoint icon (never a dead link) — AC-5.
 */
function RiskRef({
  refStr,
  repoFullName,
  headSha,
}: {
  refStr: string;
  repoFullName: string | null;
  headSha: string | null;
}) {
  if (isFilePathRef(refStr)) {
    const { path, line } = parseFileRef(refStr);
    const href =
      repoFullName && headSha ? githubBlobUrl(repoFullName, headSha, path, line) : undefined;
    const label = line != null ? `${shortenPath(path)}:${line}` : shortenPath(path);
    return (
      <span title={refStr} style={st.refLink}>
        <MonoLink href={href}>{label}</MonoLink>
      </span>
    );
  }
  return (
    <Badge icon="Globe" color="var(--accent-text)" bg="var(--accent-bg)" mono>
      {refStr}
    </Badge>
  );
}

/** One "read this first" location: file(:line) link + one-line reason. */
function ReviewFocusRow({
  item,
  repoFullName,
  headSha,
}: {
  item: ReviewFocusItem;
  repoFullName: string | null;
  headSha: string | null;
}) {
  const full = item.line != null ? `${item.file}:${item.line}` : item.file;
  const label = item.line != null ? `${shortenPath(item.file)}:${item.line}` : shortenPath(item.file);
  const href =
    repoFullName && headSha ? githubBlobUrl(repoFullName, headSha, item.file, item.line) : undefined;
  return (
    <li style={st.focusItem}>
      <div style={st.focusTop}>
        <Icon.CornerDownRight size={12} style={st.focusArrow} />
        <span title={full} style={st.refLink}>
          <MonoLink href={href}>{label}</MonoLink>
        </span>
      </div>
      {item.reason && <span style={st.focusReason}>{item.reason}</span>}
    </li>
  );
}

/** Optional observability row — model · cost · tokens (mirrors Intent/run cost). */
function CostRow({
  model,
  cost,
  tokens,
}: {
  model?: string;
  cost?: number | null;
  tokens?: { in: number; out: number };
}) {
  if (!model && cost == null && !tokens) return null;
  return (
    <div style={st.costRow}>
      {model && <span className="mono">{model}</span>}
      {cost != null && (
        <span>
          <Icon.DollarSign size={11} style={{ verticalAlign: "-1px" }} />
          {formatCost(cost)}
        </span>
      )}
      {tokens && (
        <span className="tnum">
          {tokens.in.toLocaleString()} in · {tokens.out.toLocaleString()} out
        </span>
      )}
    </div>
  );
}

// ---- ref classification (pure, module-level) ------------------------------

const HTTP_METHOD_RE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i;

/** A ref "looks like a file path" iff it has a "/", a file extension, and is
 * NOT endpoint-shaped (no HTTP method prefix, no whitespace). */
function isFilePathRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (HTTP_METHOD_RE.test(trimmed) || /\s/.test(trimmed)) return false;
  const pathPart = trimmed.replace(/:\d+$/, "");
  return pathPart.includes("/") && /\.[A-Za-z0-9]+$/.test(pathPart);
}

/** Split a trailing `:line` off a file-path ref. */
function parseFileRef(ref: string): { path: string; line?: number } {
  const m = ref.trim().match(/^(.*):(\d+)$/);
  return m ? { path: m[1]!, line: Number(m[2]) } : { path: ref.trim() };
}

/**
 * Shorten a long repo-relative path for display: keep the last two segments,
 * prefixed with `…/`. Full path stays available via the `title` attribute and
 * the link href. Deep paths like
 * `client/src/app/.../BlastRadiusCard/BlastRadiusCard.tsx` would otherwise
 * dominate/overflow the card.
 */
function shortenPath(path: string): string {
  const segs = path.split("/").filter(Boolean);
  if (segs.length <= 2) return path;
  return `…/${segs.slice(-2).join("/")}`;
}

const RISK_STYLE: Record<
  RiskSeverity,
  { color: string; bg: string; icon: IconName; label: string }
> = {
  high: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertOctagon", label: "High" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle", label: "Medium" },
  low: { color: "var(--sugg)", bg: "var(--sugg-bg)", icon: "Lightbulb", label: "Low" },
};

const RISK_LABEL_KEY: Record<RiskSeverity, "riskHigh" | "riskMedium" | "riskLow"> = {
  high: "riskHigh",
  medium: "riskMedium",
  low: "riskLow",
};

const st = {
  headerRight: { display: "flex", alignItems: "center", gap: 8 },
  empty: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center" as const,
    padding: "44px 24px",
    gap: 8,
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    display: "grid",
    placeItems: "center" as const,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 15, fontWeight: 600, color: "var(--text-primary)" },
  emptyBody: {
    fontSize: 14,
    color: "var(--text-secondary)",
    maxWidth: 340,
    lineHeight: 1.5,
    marginBottom: 8,
  },
  riskWrap: { display: "inline-flex", marginBottom: 12 },
  what: {
    fontSize: 14.5,
    color: "var(--text-primary)",
    lineHeight: 1.55,
    margin: "0 0 12px",
  },
  whyRow: { display: "flex", gap: 8, fontSize: 13.5, lineHeight: 1.55, marginBottom: 18 },
  whyLabel: {
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
    flexShrink: 0,
    marginTop: 2,
  },
  whyText: { color: "var(--text-secondary)" },
  section: { marginBottom: 18 },
  subHeader: {
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
    marginBottom: 10,
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
  },
  none: { fontSize: 13, color: "var(--text-muted)" },
  riskItem: { display: "flex", flexDirection: "column" as const, gap: 6 },
  riskHead: { display: "flex", alignItems: "center", gap: 8 },
  riskTitle: { fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)", flex: 1 },
  riskExpl: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.45, margin: 0 },
  refs: { display: "flex", flexWrap: "wrap" as const, gap: 8, marginTop: 2 },
  refLink: { minWidth: 0, overflowWrap: "anywhere" as const },
  focusItem: { display: "flex", flexDirection: "column" as const, gap: 3, fontSize: 13 },
  focusTop: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  focusArrow: { color: "var(--text-muted)", flexShrink: 0 },
  focusReason: { color: "var(--text-secondary)", lineHeight: 1.45, marginLeft: 20 },
  costRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 14,
    marginTop: 4,
    paddingTop: 12,
    borderTop: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-muted)",
  },
  picker: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
    paddingTop: 14,
    borderTop: "1px solid var(--border)",
  },
  pickerLabel: {
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
    flexShrink: 0,
  },
  pickerControl: { flex: 1, minWidth: 0 },
  srOnly: {
    position: "absolute" as const,
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden" as const,
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap" as const,
    border: 0,
  },
} satisfies Record<string, React.CSSProperties>;

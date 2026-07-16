/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { useEvalCaseSeed } from "../../../../../../../lib/hooks/eval";
import { EvalCaseEditor } from "@/components/EvalCaseEditor";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  isTarget,
  onAction,
  pending,
  repoFullName,
  headSha,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  /** Deep-link target (Smart Diff badge click): expand + scroll into view. */
  isTarget?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (isTarget) {
      setExpanded(true);
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isTarget, f.id]);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;
  // A finding becomes an eval case only once a reviewer has decided it. Derive
  // this from props every render — never mirror it into state.
  const decided = accepted || dismissed;

  // Deciding a finding (or clicking the flask) opens the "New eval case" modal,
  // seeded server-side from the finding + the decision. `null` ⇒ modal closed.
  const [seedDecision, setSeedDecision] = React.useState<null | "accepted" | "dismissed">(null);
  const seedQuery = useEvalCaseSeed(f.id, seedDecision ?? "accepted", seedDecision !== null);
  const seed = seedQuery.data;

  return (
    <>
    <div ref={rootRef} data-finding-id={f.id} style={{ ...s.card(!!focused, sevColor, muted), scrollMarginTop: 16 }}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              style={accepted ? { color: "var(--ok)", borderColor: "var(--ok)" } : undefined}
              onClick={() => {
                onAction?.("accept");
                setSeedDecision("accepted");
              }}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => {
                onAction?.("dismiss");
                setSeedDecision("dismissed");
              }}
            >
              {t("finding.dismiss")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="FlaskConical"
              aria-label={t("finding.turnIntoEvalCase")}
              title={decided ? t("finding.turnIntoEvalCase") : t("finding.turnIntoEvalCaseHint")}
              disabled={!decided}
              onClick={() => setSeedDecision(accepted ? "accepted" : "dismissed")}
            >
              {t("finding.turnIntoEvalCase")}
            </Button>
          </div>
        </div>
      )}
    </div>

    {seedDecision !== null && seed && (
      <EvalCaseEditor
        mode="create"
        agentId={seed.owner_id}
        ownerKind="agent"
        ownerId={seed.owner_id}
        title="New eval case"
        subtitle={
          seedDecision === "accepted"
            ? "Seeded from an accepted finding · assert the expected output"
            : "Seeded from a dismissed finding · assert the expected output"
        }
        initial={{
          name: seed.name,
          input_diff: seed.input_diff,
          input_files: seed.input_files,
          input_meta: seed.input_meta,
          expected_output: seed.expected_output,
        }}
        onClose={() => setSeedDecision(null)}
      />
    )}
    </>
  );
}

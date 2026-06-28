/* ConventionCard — one extracted house-rule candidate.
   Adapts the accept/dismiss pattern from FindingCard: Accept/Reject buttons whose
   `active` reflects the persisted status, a confidence visual, the grounded code
   snippet in a <pre>, a github file:line deep-link, a category badge, and inline
   edit of the rule text. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  ConfidenceNum,
  MonoLink,
  ProgressBar,
  TextInput,
} from "@devdigest/ui";
import { githubBlobUrl } from "@/lib/github-urls";
import type { ConventionCandidate } from "@/lib/hooks/conventions";
import { s } from "./styles";

export function ConventionCard({
  candidate: c,
  pending,
  repoFullName,
  defaultBranch,
  onAccept,
  onReject,
  onEditRule,
}: {
  candidate: ConventionCandidate;
  pending?: boolean;
  repoFullName?: string | null;
  defaultBranch?: string | null;
  onAccept: () => void;
  onReject: () => void;
  onEditRule: (rule: string) => void;
}) {
  const t = useTranslations("conventions.card");
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(c.rule);

  // Keep the local draft in sync if the rule changes underneath us (re-scan).
  React.useEffect(() => {
    if (!editing) setDraft(c.rule);
  }, [c.rule, editing]);

  const accepted = c.status === "accepted";
  const rejected = c.status === "rejected";
  const pct = Math.round(c.confidence * 100);

  const fileHref =
    repoFullName && defaultBranch
      ? githubBlobUrl(
          repoFullName,
          defaultBranch,
          c.evidence_path,
          c.evidence_start_line ?? undefined,
          c.evidence_end_line ?? undefined,
        )
      : undefined;

  const lineLabel =
    c.evidence_start_line != null
      ? c.evidence_end_line != null && c.evidence_end_line !== c.evidence_start_line
        ? `${c.evidence_start_line}-${c.evidence_end_line}`
        : String(c.evidence_start_line)
      : null;

  const saveEdit = () => {
    const next = draft.trim();
    if (next && next !== c.rule) onEditRule(next);
    setEditing(false);
  };

  return (
    <div style={s.card(rejected)}>
      <div style={s.topRow}>
        <div style={s.ruleWrap}>
          {editing ? (
            <div style={s.editRow}>
              <TextInput value={draft} onChange={setDraft} />
              <Button kind="primary" size="sm" onClick={saveEdit} disabled={pending}>
                {t("save")}
              </Button>
              <Button
                kind="ghost"
                size="sm"
                onClick={() => {
                  setDraft(c.rule);
                  setEditing(false);
                }}
              >
                {t("cancel")}
              </Button>
            </div>
          ) : (
            <div style={s.rule}>{c.rule}</div>
          )}
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {c.evidence_path}
              {lineLabel ? `:${lineLabel}` : ""}
            </MonoLink>
            {!editing && (
              <Button kind="ghost" size="sm" icon="Edit" onClick={() => setEditing(true)}>
                {t("editRule")}
              </Button>
            )}
          </div>
        </div>
        <div style={s.badgeCol}>
          <Badge>{c.category ?? t("uncategorized")}</Badge>
          <ConfidenceNum value={c.confidence} />
        </div>
      </div>

      <div style={s.confidenceRow}>
        <ProgressBar value={pct} />
      </div>

      <pre className="mono" style={s.snippet}>
        {c.evidence_snippet}
      </pre>

      <div style={s.actions}>
        <Button
          kind="secondary"
          size="sm"
          icon="Check"
          disabled={pending}
          active={accepted}
          onClick={onAccept}
        >
          {accepted ? t("accepted") : t("accept")}
        </Button>
        <Button
          kind="ghost"
          size="sm"
          icon="X"
          disabled={pending}
          active={rejected}
          onClick={onReject}
        >
          {rejected ? t("rejected") : t("reject")}
        </Button>
      </div>
    </div>
  );
}

"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, MonoLink } from "@devdigest/ui";
import type { BlastRadius, ChangedSymbol, DownstreamImpact } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

interface BlastTreeProps {
  blast: BlastRadius;
  /** owner/repo for github deep-links; null until the repo loads. */
  repoFullName: string | null;
  /** PR head sha — pins caller links to the right lines. */
  headSha: string | null;
}

/**
 * The Blast Radius tree: one collapsible node per changed symbol →
 * its callers (`file:line`, clicking opens the code on GitHub at that line) →
 * the endpoints / cron jobs those callers expose. Read-only; no model call.
 */
export function BlastTree({ blast, repoFullName, headSha }: BlastTreeProps) {
  const kindBySymbol = new Map<string, string>(
    blast.changed_symbols.map((c: ChangedSymbol) => [c.name, c.kind]),
  );

  return (
    <div style={s.root}>
      {blast.downstream.map((node, i) => (
        <BlastNode
          key={`${node.symbol}-${i}`}
          node={node}
          kind={kindBySymbol.get(node.symbol)}
          repoFullName={repoFullName}
          headSha={headSha}
        />
      ))}
    </div>
  );
}

function BlastNode({
  node,
  kind,
  repoFullName,
  headSha,
}: {
  node: DownstreamImpact;
  kind?: string;
  repoFullName: string | null;
  headSha: string | null;
}) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState(true);
  const Chevron = open ? Icon.ChevronDown : Icon.ChevronRight;

  return (
    <div style={s.node}>
      <button style={s.nodeHeader} onClick={() => setOpen((o) => !o)}>
        <span style={s.chevron}>
          <Chevron size={14} />
        </span>
        <Icon.Code size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span className="mono" style={s.symbolName}>
          {node.symbol}
          {kind ? <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {kind}</span> : null}
        </span>
        <span style={s.callerCount}>{t("callerCount", { count: node.callers.length })}</span>
      </button>

      {open && (
        <div style={s.body}>
          {node.callers.length === 0 ? (
            <div style={s.none}>{t("noCallers")}</div>
          ) : (
            node.callers.map((c, i) => {
              const href =
                repoFullName && headSha
                  ? githubBlobUrl(repoFullName, headSha, c.file, c.line)
                  : undefined;
              return (
                <div key={`${c.file}-${c.line}-${i}`} style={s.callerRow}>
                  <Icon.CornerDownRight size={12} style={s.callerArrow} />
                  <MonoLink href={href}>
                    {c.file}:{c.line}
                  </MonoLink>
                </div>
              );
            })
          )}

          {(node.endpoints_affected.length > 0 || node.crons_affected.length > 0) && (
            <div style={s.badges}>
              {node.endpoints_affected.map((e) => (
                <Badge key={e} icon="Globe" color="var(--accent-text)" bg="var(--accent-bg)" mono>
                  {e}
                </Badge>
              ))}
              {node.crons_affected.map((c) => (
                <Badge key={c} icon="Clock" color="var(--warn)" bg="transparent" mono>
                  {c}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

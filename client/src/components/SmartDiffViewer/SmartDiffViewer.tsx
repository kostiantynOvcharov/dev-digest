/* SmartDiffViewer — reviewer-ordered diff. Renders the server's Smart Diff
   groups (core → wiring → boilerplate) as collapsible FileCards: business logic
   first, generated noise collapsed at the bottom. When a review exists, each
   line with a finding shows a clickable severity badge that deep-links to the
   matching FindingCard on the Findings tab. NO model call — pure composition. */
"use client";

import React from "react";
import { SeverityBadge, type Severity } from "@devdigest/ui";
import type { FindingRecord, PrFile, SmartDiffGroup } from "@devdigest/shared";
import { FileCard } from "@/components/diff-viewer/FileCard";
import { ROLE_META, SEVERITY_RANK } from "./constants";
import { s } from "./styles";

interface SmartDiffViewerProps {
  groups: SmartDiffGroup[];
  /** Full PR files (carry the patch text the groups reference by path). */
  files: PrFile[];
  /** Latest-review findings — the per-line + per-file overlay. */
  findings: FindingRecord[];
  /** Click a finding badge → deep-link to that finding on the Findings tab. */
  onOpenFinding?: (findingId: string) => void;
}

export function SmartDiffViewer({ groups, files, findings, onOpenFinding }: SmartDiffViewerProps) {
  const filesByPath = React.useMemo(
    () => new Map(files.map((f) => [f.path, f])),
    [files],
  );

  // Per file: NEW-line → the most severe finding on that line (the badge), and
  // the file's most severe finding + count (the header badge).
  const overlay = React.useMemo(() => {
    const byPath = new Map<string, Map<number, FindingRecord>>();
    const summary = new Map<string, { severity: Severity; count: number }>();
    for (const f of findings) {
      let lines = byPath.get(f.file);
      if (!lines) {
        lines = new Map();
        byPath.set(f.file, lines);
      }
      const existing = lines.get(f.start_line);
      if (!existing || SEVERITY_RANK[f.severity as Severity] > SEVERITY_RANK[existing.severity as Severity]) {
        lines.set(f.start_line, f);
      }
      const sum = summary.get(f.file);
      if (!sum) {
        summary.set(f.file, { severity: f.severity as Severity, count: 1 });
      } else {
        sum.count += 1;
        if (SEVERITY_RANK[f.severity as Severity] > SEVERITY_RANK[sum.severity]) {
          sum.severity = f.severity as Severity;
        }
      }
    }
    return { byPath, summary };
  }, [findings]);

  if (groups.length === 0) {
    return <div style={s.empty}>No changed files.</div>;
  }

  return (
    <div style={s.root}>
      {groups.map((group) => {
        const meta = ROLE_META[group.role];
        return (
          <div key={group.role} style={s.group}>
            <div style={s.groupHeader}>
              <span style={s.dot(meta.dot)} />
              <span style={s.roleLabel}>{meta.label}</span>
              <span style={s.roleDesc}>{meta.description}</span>
              <span style={s.fileCount}>
                {group.files.length} file{group.files.length === 1 ? "" : "s"}
              </span>
            </div>
            {group.files.map((sf) => {
              const file: PrFile = filesByPath.get(sf.path) ?? {
                path: sf.path,
                additions: sf.additions,
                deletions: sf.deletions,
                patch: null,
              };
              const sum = overlay.summary.get(sf.path);
              return (
                <FileCard
                  key={sf.path}
                  file={file}
                  // Read order: core open, boilerplate collapsed, wiring by size.
                  defaultOpen={group.role === "core" ? true : group.role === "boilerplate" ? false : undefined}
                  lineFindings={overlay.byPath.get(sf.path)}
                  onFindingClick={onOpenFinding}
                  headerExtra={
                    sum ? <SeverityBadge severity={sum.severity} count={sum.count} compact /> : undefined
                  }
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

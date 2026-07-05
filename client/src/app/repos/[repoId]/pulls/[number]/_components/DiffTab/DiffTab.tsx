"use client";

import React from "react";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { SmartDiffViewer } from "@/components/SmartDiffViewer";
import { usePrComments, useCreatePrComment, useSmartDiff, usePrReviews } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** Deep-link a finding badge → Findings tab + auto-expanded FindingCard. */
  onOpenFinding?: (findingId: string) => void;
}

export function DiffTab({ prId, filesCount, files, canComment, onOpenFinding }: DiffTabProps) {
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  // Smart order (risk-grouped) is the default; reviewers can fall back to the
  // raw GitHub file order.
  const [order, setOrder] = React.useState<"smart" | "original">("smart");

  const { data: smart } = useSmartDiff(prId);
  // The per-line/-file overlay comes from the LATEST review (reviews are
  // newest-first), matching the findings the server used to compose the diff.
  const { data: reviews } = usePrReviews(prId);
  const latestFindings = reviews?.[0]?.findings ?? [];

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {commentCount > 0 && order === "original" && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
            <Button
              kind={order === "smart" ? "secondary" : "ghost"}
              size="sm"
              active={order === "smart"}
              onClick={() => setOrder("smart")}
            >
              Smart order
            </Button>
            <Button
              kind={order === "original" ? "secondary" : "ghost"}
              size="sm"
              active={order === "original"}
              onClick={() => setOrder("original")}
            >
              Original order
            </Button>
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>
      {order === "smart" && smart ? (
        <SmartDiffViewer
          groups={smart.groups}
          files={files}
          findings={latestFindings}
          onOpenFinding={onOpenFinding}
        />
      ) : (
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}

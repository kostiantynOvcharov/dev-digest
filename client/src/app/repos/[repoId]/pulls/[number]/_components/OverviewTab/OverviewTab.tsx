"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { BlastCard } from "../BlastCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  /** owner/repo for the Blast card's github deep-links; null until the repo loads. */
  repoFullName: string | null;
  /** PR head sha — pins Blast caller links to the right lines. */
  headSha: string | null;
}

export function OverviewTab({ prBody, prId, repoFullName, headSha }: OverviewTabProps) {
  return (
    <>
      <div style={s.brief}>
        <IntentCard prId={prId} />
        <BlastCard prId={prId} repoFullName={repoFullName} headSha={headSha} />
      </div>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}

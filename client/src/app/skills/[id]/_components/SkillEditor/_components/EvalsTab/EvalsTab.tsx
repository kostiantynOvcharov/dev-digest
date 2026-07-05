/* Evals tab — placeholder. Skill evals (owner_kind 'skill') arrive in a later
   lesson; the tab exists for parity with the agent editor. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";

export function EvalsTab() {
  const t = useTranslations("skills");
  return (
    <div style={{ maxWidth: 760 }}>
      <EmptyState icon="FlaskConical" title={t("editor.evals.title")} body={t("editor.evals.body")} />
    </div>
  );
}

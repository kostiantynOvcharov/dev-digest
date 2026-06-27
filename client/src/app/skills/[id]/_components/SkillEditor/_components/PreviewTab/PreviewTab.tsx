/* Preview tab — the skill body rendered as the reviewing agent receives it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div style={{ maxWidth: 820 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>{t("editor.preview.title")}</h2>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 18px" }}>
        {t("editor.preview.subtitle")}
      </p>
      <div
        style={{
          padding: 24,
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "var(--bg-surface)",
        }}
      >
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}

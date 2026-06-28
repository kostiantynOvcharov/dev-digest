/* Versions tab — body snapshot history. Each save snapshots the body so eval
   runs stay reproducible. View expands the snapshot; Restore re-saves an old
   body (which itself becomes a new version). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillVersions, useUpdateSkill } from "../../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../../lib/toast";
import { s } from "./styles";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading } = useSkillVersions(skill.id);
  const update = useUpdateSkill();
  const [open, setOpen] = React.useState<number | null>(null);

  const restore = (version: number, body: string) =>
    update.mutate(
      { id: skill.id, patch: { body } },
      {
        onSuccess: (data) =>
          toast.success(t("editor.versions.restored", { version, newVersion: data.version })),
      },
    );

  if (isLoading) return <Skeleton height={200} />;
  const list = versions ?? [];

  return (
    <div style={s.wrap}>
      <div style={s.titleRow}>
        <h2 style={s.h2}>{t("editor.versions.title")}</h2>
        <Badge color="var(--text-secondary)">{t("editor.versions.count", { count: list.length })}</Badge>
      </div>
      <p style={s.subtitle}>{t("editor.versions.subtitle")}</p>

      {list.length === 0 ? (
        <div style={s.empty}>{t("editor.versions.empty")}</div>
      ) : (
        <div style={s.list}>
          {list.map((v) => {
            const isCurrent = v.version === skill.version;
            return (
              <div key={v.version} style={s.row}>
                <div style={s.rowHead}>
                  <span style={s.versionBadge}>v{v.version}</span>
                  <span style={s.date}>{new Date(v.created_at).toLocaleDateString()}</span>
                  <div style={s.rowActions}>
                    {isCurrent ? (
                      <Badge color="var(--ok)" dot>
                        {t("editor.versions.current")}
                      </Badge>
                    ) : (
                      <Button
                        kind="secondary"
                        size="sm"
                        icon="History"
                        onClick={() => restore(v.version, v.body)}
                        disabled={update.isPending}
                      >
                        {t("editor.versions.restore")}
                      </Button>
                    )}
                    <Button
                      kind="ghost"
                      size="sm"
                      icon="Eye"
                      onClick={() => setOpen(open === v.version ? null : v.version)}
                    >
                      {t("editor.versions.view")}
                    </Button>
                  </div>
                </div>
                {open === v.version && <pre style={s.body}>{v.body}</pre>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* SkillCard — name, type + source badges, enabled toggle, usage line.
   Mirrors AgentCard; used in the Skills list and the editor's left rail. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useDeleteSkill } from "../../../../lib/hooks/skills";
import { typeColor, sourceLabel } from "./helpers";
import { s } from "./styles";

export function SkillCard({
  sk,
  active,
  agentCount,
  onClick,
  onToggle,
}: {
  sk: Skill;
  active?: boolean;
  agentCount?: number;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const del = useDeleteSkill();
  const src = sourceLabel(sk.source);
  return (
    <div onClick={onClick} style={s.card(!!active, sk.enabled)}>
      <div style={s.headerRow}>
        <span style={s.iconBox}>
          <Icon.Sparkles size={14} />
        </span>
        <span style={s.name}>{sk.name}</span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={sk.enabled} onChange={onToggle} size={14} />
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Delete skill "${sk.name}"? This cannot be undone.`)) del.mutate(sk.id);
          }}
          disabled={del.isPending}
          title="Delete skill"
          aria-label="Delete skill"
          style={s.trashBtn(del.isPending)}
        >
          <Icon.Trash size={14} style={del.isPending ? { animation: "ddspin 1s linear infinite" } : undefined} />
        </button>
      </div>
      <div style={s.description}>{sk.description || t("card.noDescription")}</div>
      <div style={s.badgeRow}>
        <Badge color={typeColor(sk.type)}>{t(`listItem.type.${sk.type}`)}</Badge>
        <Badge color={src.untrusted ? "var(--text-muted)" : "var(--text-secondary)"} icon={src.icon}>
          {src.label}
        </Badge>
        {src.untrusted && !sk.enabled && (
          <Badge color="var(--warn, var(--text-muted))" icon="AlertTriangle">
            {t("card.needsVetting")}
          </Badge>
        )}
      </div>
      {agentCount != null && (
        <div style={s.usage}>
          <span>{t("card.usage", { count: agentCount })}</span>
        </div>
      )}
    </div>
  );
}

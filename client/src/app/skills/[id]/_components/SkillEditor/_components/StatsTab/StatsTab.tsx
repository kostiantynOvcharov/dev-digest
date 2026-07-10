/* Stats tab — USED BY + the agents-using list are real (from the skill→agents
   join); pull/accept/findings + the category donut are design placeholders ("—")
   until the analytics pipeline lands. We never fabricate metrics. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillAgents } from "../../../../../../../lib/hooks/skills";
import { s } from "./styles";

function Metric({ label, value, unit }: { label: string; value: React.ReactNode; unit?: string }) {
  return (
    <div style={s.metric}>
      <div style={s.metricLabel}>{label}</div>
      <div style={s.metricValue}>
        {value}
        {unit && <span style={s.metricUnit}> {unit}</span>}
      </div>
    </div>
  );
}

export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: agents, isLoading } = useSkillAgents(skill.id);
  const ph = t("editor.stats.placeholder");

  return (
    <div style={s.wrap}>
      <div style={s.metricsRow}>
        <Metric label={t("editor.stats.usedBy")} value={agents?.length ?? 0} unit={t("editor.stats.usedByUnit")} />
        <Metric label={t("editor.stats.pullFrequency")} value={ph} />
        <Metric label={t("editor.stats.acceptRate")} value={ph} />
        <Metric label={t("editor.stats.findings30d")} value={ph} />
      </div>

      <div style={s.panels}>
        <div style={s.panel}>
          <div style={s.panelTitle}>
            <Icon.Users size={14} /> {t("editor.stats.agentsUsing")}
          </div>
          {isLoading ? (
            <Skeleton height={48} />
          ) : (agents ?? []).length === 0 ? (
            <div style={s.empty}>{t("editor.stats.noAgents")}</div>
          ) : (
            <div style={s.agentList}>
              {(agents ?? []).map((a) => (
                <button key={a.id} style={s.agentRow} onClick={() => router.push(`/agents/${a.id}?tab=skills`)}>
                  <Icon.Cpu size={15} style={{ color: "var(--accent)" }} />
                  <span style={s.agentName}>{a.name}</span>
                  <span style={s.open}>{t("editor.stats.open")}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={s.panel}>
          <div style={s.panelTitle}>
            <Icon.Tag size={14} /> {t("editor.stats.findingsByCategory")}
          </div>
          <div style={s.empty}>{ph}</div>
        </div>
      </div>
    </div>
  );
}

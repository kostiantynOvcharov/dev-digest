/* Skills tab — attach/detach skills to an agent and reorder the attached set.
   Order = the sequence of blocks in the prompt's "Skills / rules" section.
   A globally-disabled skill stays attachable but is flagged "not sent". */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Checkbox, EmptyState } from "@devdigest/ui";
import type { Agent, Skill } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills } from "../../../../../../../lib/hooks/agents";
import { useSkills } from "../../../../../../../lib/hooks/skills";
import { typeColor } from "../../../../../../skills/_components/SkillCard/helpers";
import { s } from "./styles";

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const tt = useTranslations("skills");
  const { data: allSkills } = useSkills();
  const { data: links } = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills(agent.id);

  // Ordered linked ids — seeded from the server, persisted on every change.
  const serverIds = React.useMemo(() => (links ?? []).map((l) => l.skill_id), [links]);
  const [order, setOrder] = React.useState<string[]>(serverIds);
  const dragIndex = React.useRef<number | null>(null);
  const lastSync = React.useRef<string>("");

  // Re-seed local order when the server set changes (and we didn't cause it).
  React.useEffect(() => {
    const key = serverIds.join(",");
    if (key !== lastSync.current) {
      lastSync.current = key;
      setOrder(serverIds);
    }
  }, [serverIds]);

  const byId = React.useMemo(() => {
    const m = new Map<string, Skill>();
    for (const sk of allSkills ?? []) m.set(sk.id, sk);
    return m;
  }, [allSkills]);

  const [filter, setFilter] = React.useState("");
  const q = filter.trim().toLowerCase();
  const matches = (sk: Skill) =>
    !q || sk.name.toLowerCase().includes(q) || sk.description.toLowerCase().includes(q);

  const persist = (ids: string[]) => {
    setOrder(ids);
    lastSync.current = ids.join(",");
    setSkills.mutate(ids);
  };

  const toggle = (id: string) =>
    persist(order.includes(id) ? order.filter((x) => x !== id) : [...order, id]);

  const onDrop = (to: number) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    persist(next);
  };

  const linked = order.map((id) => byId.get(id)).filter((x): x is Skill => !!x);
  const available = (allSkills ?? [])
    .filter((sk) => !order.includes(sk.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  if ((allSkills ?? []).length === 0) {
    return <EmptyState icon="Sparkles" title={t("skills.title")} body={t("skills.empty")} />;
  }

  const linkedVisible = linked.filter(matches);
  const availableVisible = available.filter(matches);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--text-secondary)">
          {t("skills.enabledCount", { linked: linked.length, total: (allSkills ?? []).length })}
        </Badge>
        <div style={s.search}>
          <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("skills.filterPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>
      <p style={s.hint}>{t("skills.orderHint")}</p>

      {linkedVisible.length > 0 && (
        <>
          <div style={s.sectionLabel}>{t("skills.linkedSection")}</div>
          <div style={s.list}>
            {linkedVisible.map((sk) => {
              const idx = order.indexOf(sk.id);
              return (
                <div
                  key={sk.id}
                  draggable
                  onDragStart={() => (dragIndex.current = idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(idx)}
                  style={s.row(true)}
                >
                  <Icon.Menu size={14} style={s.handle} />
                  <Checkbox checked onChange={() => toggle(sk.id)} />
                  <span style={s.name}>{sk.name}</span>
                  {!sk.enabled && <Badge color="var(--text-muted)">{t("skills.globallyDisabled")}</Badge>}
                  <Badge color={typeColor(sk.type)}>{tt(`listItem.type.${sk.type}`)}</Badge>
                </div>
              );
            })}
          </div>
        </>
      )}

      {availableVisible.length > 0 && (
        <>
          <div style={s.sectionLabel}>{t("skills.availableSection")}</div>
          <div style={s.list}>
            {availableVisible.map((sk) => (
              <div key={sk.id} style={s.row(false)}>
                <span style={{ width: 14 }} />
                <Checkbox checked={false} onChange={() => toggle(sk.id)} />
                <span style={s.name}>{sk.name}</span>
                {!sk.enabled && <Badge color="var(--text-muted)">{t("skills.globallyDisabled")}</Badge>}
                <Badge color={typeColor(sk.type)}>{tt(`listItem.type.${sk.type}`)}</Badge>
              </div>
            ))}
          </div>
        </>
      )}

      {linkedVisible.length === 0 && availableVisible.length === 0 && (
        <div style={s.noResults}>{t("skills.noResults")}</div>
      )}
    </div>
  );
}

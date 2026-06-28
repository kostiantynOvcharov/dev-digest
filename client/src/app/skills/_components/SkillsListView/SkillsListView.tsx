/* /skills — Skills list. Card grid + "Add Skill" (create / import). Selecting a
   skill opens the tabbed editor at /skills/:id. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Skeleton, Icon } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useSkills, useCreateSkill, useUpdateSkill } from "../../../../lib/hooks/skills";
import { SkillCard } from "../SkillCard";
import { ImportDrawer } from "../ImportDrawer";
import { filterSkills, BLANK_SKILL_BODY } from "./helpers";
import { s } from "./styles";

export function SkillsListView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const create = useCreateSkill();
  const update = useUpdateSkill();
  const [search, setSearch] = React.useState("");
  const [importing, setImporting] = React.useState(false);

  const list = filterSkills(skills ?? [], search);

  const createFromScratch = async () => {
    const skill = await create.mutateAsync({
      name: "new-skill",
      description: "",
      type: "custom",
      body: BLANK_SKILL_BODY,
      source: "manual",
    });
    router.push(`/skills/${skill.id}?tab=config`);
  };

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {importing && (
        <ImportDrawer
          onClose={() => setImporting(false)}
          onCreated={(skill) => {
            setImporting(false);
            router.push(`/skills/${skill.id}?tab=config`);
          }}
        />
      )}
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("list.title")}</h1>
            <p style={s.subtitle}>{t("list.subtitle")}</p>
          </div>
          <div style={s.search}>
            <Icon.Search size={13} style={s.searchIcon} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("list.searchPlaceholder")}
              style={s.searchInput}
            />
          </div>
          <Dropdown
            width={220}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("list.addSkill")}
              </Button>
            }
            items={[
              { label: t("list.createFromScratch"), icon: "Edit", onClick: createFromScratch },
              { divider: true },
              { label: t("list.importFromFile"), icon: "Upload", onClick: () => setImporting(true) },
            ]}
          />
        </div>

        {isLoading && (
          <div style={s.grid}>
            <Skeleton height={140} />
            <Skeleton height={140} />
            <Skeleton height={140} />
          </div>
        )}
        {isError && <ErrorState body={t("list.loadError")} onRetry={() => refetch()} />}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            icon="Sparkles"
            title={t("list.emptyTitle")}
            body={t("list.emptyBody")}
            cta={t("list.emptyCta")}
            onCta={createFromScratch}
          />
        )}
        {list.length > 0 && (
          <div style={s.grid}>
            {list.map((sk) => (
              <SkillCard
                key={sk.id}
                sk={sk}
                onClick={() => router.push(`/skills/${sk.id}?tab=config`)}
                onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

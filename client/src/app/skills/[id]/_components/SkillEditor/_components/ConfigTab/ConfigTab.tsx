/* Config tab — name/description/type + the markdown skill body editor (filename
   header, token estimate, unsaved indicator) + enabled toggle. Saving a changed
   body bumps the skill version (server-side snapshot). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, TextInput, SelectInput, Textarea, Toggle, Button } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "../../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../../lib/toast";
import { SKILL_TYPE_OPTIONS, estimateTokens, slugify } from "./constants";
import { s } from "./styles";

export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();
  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [enabled, setEnabled] = React.useState(skill.enabled);

  // State seeds from `skill`; switching skills remounts via key={skill.id}.
  const dirty =
    name !== skill.name ||
    description !== skill.description ||
    type !== skill.type ||
    body !== skill.body ||
    enabled !== skill.enabled;
  const bodyDirty = body !== skill.body;

  const typeOptions = React.useMemo(
    () => SKILL_TYPE_OPTIONS.map((v) => ({ value: v, label: t(`listItem.type.${v}`) })),
    [t],
  );

  const save = () =>
    update.mutate(
      { id: skill.id, patch: { name, description, type, body, enabled } },
      { onSuccess: (data) => toast.success(t("editor.config.savedToast", { version: data.version })) },
    );

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("editor.config.title")}</h2>
        <label style={s.enabledLabel}>
          {t("editor.config.enabled")}
          <Toggle on={enabled} onChange={setEnabled} size={16} />
        </label>
      </div>

      <FormField label={t("editor.config.name")} required>
        <TextInput value={name} onChange={setName} mono />
      </FormField>
      <FormField label={t("editor.config.description")} hint={t("editor.config.descriptionHint")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>
      <FormField label={t("editor.config.type")}>
        <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
      </FormField>

      <FormField label={t("editor.config.body")} hint={t("editor.config.bodyHint")} required>
        <div style={s.bodyHeader}>
          <span style={s.filename}>{slugify(name)}.md</span>
          {bodyDirty && <span style={s.unsaved}>{t("editor.config.unsaved")}</span>}
          <span style={s.tokens}>{t("editor.config.tokens", { count: estimateTokens(body) })}</span>
        </div>
        <Textarea value={body} onChange={setBody} rows={16} mono />
      </FormField>

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={!dirty || update.isPending}>
          {update.isPending ? t("editor.config.saving") : t("editor.config.save")}
        </Button>
        {update.isSuccess && (
          <span style={s.savedNote}>{t("editor.config.saved", { version: update.data?.version })}</span>
        )}
      </div>
    </div>
  );
}

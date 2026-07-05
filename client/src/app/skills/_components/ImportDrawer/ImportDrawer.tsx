/* ImportDrawer — "From file" skill import: pick a .md/.zip, preview the
   extracted markdown core + the ignored (never-executed) archive entries, then
   confirm to create the skill (source: imported_file, enabled: false). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Drawer, Button, FormField, TextInput, SelectInput, Badge, Icon } from "@devdigest/ui";
import type { Skill, SkillImportPreview, SkillType } from "@devdigest/shared";
import { useImportSkillPreview, useCreateSkill } from "../../../../lib/hooks/skills";
import { ApiError } from "../../../../lib/api";
import { SKILL_TYPE_OPTIONS } from "./constants";
import { s } from "./styles";

/** Read a File as raw base64 (strip the data: URL prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function ImportDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (skill: Skill) => void;
}) {
  const t = useTranslations("skills");
  const preview = useImportSkillPreview();
  const create = useCreateSkill();

  const [filename, setFilename] = React.useState<string>("");
  const [data, setData] = React.useState<SkillImportPreview | null>(null);
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [error, setError] = React.useState<string | null>(null);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setFilename(file.name);
    try {
      const content_base64 = await fileToBase64(file);
      const result = await preview.mutateAsync({ filename: file.name, content_base64 });
      setData(result);
      setName(result.name);
      setType(result.type);
    } catch (e) {
      setData(null);
      setError(e instanceof ApiError ? e.message : t("importDrawer.parseError"));
    }
  };

  const confirm = async () => {
    if (!data) return;
    const skill = await create.mutateAsync({
      name: name.trim() || data.name,
      description: data.description,
      type,
      body: data.body,
      source: "imported_file",
      enabled: false,
    });
    onCreated(skill);
  };

  return (
    <Drawer
      width={760}
      title={t("drawer.title")}
      subtitle={t("drawer.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("importDrawer.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Upload"
            onClick={confirm}
            disabled={!data || create.isPending}
          >
            {create.isPending ? t("importDrawer.confirming") : t("importDrawer.confirm")}
          </Button>
        </div>
      }
    >
      <label style={s.picker}>
        <Icon.Upload size={16} />
        <span>{preview.isPending ? t("importDrawer.picking") : t("importDrawer.pick")}</span>
        <input
          type="file"
          accept=".md,.markdown,.zip"
          style={{ display: "none" }}
          onChange={(e) => onPick(e.target.files?.[0])}
        />
      </label>
      {filename && <div style={s.filename}>{filename}</div>}
      {error && <div style={s.error}>{error}</div>}

      {data && (
        <div style={s.previewWrap}>
          <div style={s.untrusted}>
            <Icon.Shield size={14} />
            <span>{t("importDrawer.untrusted")}</span>
          </div>

          <FormField label={t("file.nameLabel")}>
            <TextInput value={name} onChange={setName} mono />
          </FormField>
          <FormField label={t("editor.config.type")}>
            <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={[...SKILL_TYPE_OPTIONS]} />
          </FormField>

          <div style={s.sectionLabel}>{t("importDrawer.previewTitle")}</div>
          <pre style={s.body}>{data.body}</pre>

          <div style={s.sectionLabel}>
            {t("importDrawer.ignoredTitle", { count: data.ignored_files.length })}
          </div>
          {data.ignored_files.length === 0 ? (
            <div style={s.ignoredEmpty}>—</div>
          ) : (
            <>
              <div style={s.ignoredHint}>{t("importDrawer.ignoredHint")}</div>
              <ul style={s.ignoredList}>
                {data.ignored_files.map((f) => (
                  <li key={f.path} style={s.ignoredItem}>
                    <Icon.File size={13} />
                    <span style={s.ignoredPath}>{f.path}</span>
                    <Badge color="var(--text-muted)">{f.reason}</Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

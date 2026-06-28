/* CreateSkillModal — merge accepted conventions into a single reusable Skill.
   Modeled after CreateAgentModal. On open it asks the server to compose a draft
   ({name, description, type:'convention', body}) from the repo's accepted
   candidates and prefills the form; every field stays editable (an "unsaved"
   hint signals it's a draft). On Create it POSTs via the existing useCreateSkill
   with source:'extracted' and the accepted candidates' evidence paths. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, Icon, Modal, TextInput, Textarea } from "@devdigest/ui";
import { useCreateSkill } from "@/lib/hooks/skills";
import { useConventionSkillDraft } from "@/lib/hooks/conventions";
import { useToast } from "@/lib/toast";
import { s } from "./styles";

const MODAL_WIDTH = 720;

export function CreateSkillModal({
  repoId,
  evidenceFiles,
  onClose,
}: {
  repoId: string;
  /** Accepted candidates' evidence paths, persisted on the skill. */
  evidenceFiles: string[];
  onClose: () => void;
}) {
  const t = useTranslations("conventions.modal");
  const router = useRouter();
  const toast = useToast();

  const draftMut = useConventionSkillDraft(repoId);
  const create = useCreateSkill();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [body, setBody] = React.useState("");
  const [prefilled, setPrefilled] = React.useState(false);

  // Compose the draft once when the modal opens. mutateAsync keeps it to a
  // single call (StrictMode-safe via the prefilled guard).
  const { mutateAsync: composeDraft } = draftMut;
  React.useEffect(() => {
    let cancelled = false;
    composeDraft()
      .then((d) => {
        if (cancelled) return;
        setName(d.name);
        setDescription(d.description);
        setBody(d.body);
        setPrefilled(true);
      })
      .catch(() => {
        /* surfaced via draftMut.isError below */
      });
    return () => {
      cancelled = true;
    };
  }, [composeDraft]);

  const submit = async () => {
    const skill = await create.mutateAsync({
      name: name.trim() || "repo-conventions",
      description,
      type: "convention",
      source: "extracted",
      body,
      evidence_files: evidenceFiles,
    });
    toast.success(t("created"));
    onClose();
    router.push(`/skills/${skill.id}`);
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("title")}
      subtitle={t("subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {prefilled && (
            <span style={s.unsaved}>
              <Icon.AlertTriangle size={13} />
              {t("unsaved")}
            </span>
          )}
          <Button kind="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Plus"
            onClick={submit}
            disabled={!prefilled || create.isPending}
          >
            {create.isPending ? t("creating") : t("create")}
          </Button>
        </div>
      }
    >
      {draftMut.isPending && !prefilled ? (
        <div style={s.loading}>{t("drafting")}</div>
      ) : draftMut.isError && !prefilled ? (
        <div style={s.error}>{t("draftError")}</div>
      ) : (
        <div style={s.body}>
          <FormField label={t("fields.name")} required>
            <TextInput value={name} onChange={setName} mono />
          </FormField>
          <FormField label={t("fields.description")}>
            <TextInput value={description} onChange={setDescription} />
          </FormField>
          <FormField label={t("fields.type")}>
            <TextInput value="convention" mono />
          </FormField>
          <FormField
            label={t("fields.body")}
            right={<span style={s.tokenCount}>{t("fields.tokenCount", { count: body.length })}</span>}
          >
            <Textarea value={body} onChange={setBody} rows={14} mono />
          </FormField>
        </div>
      )}
    </Modal>
  );
}

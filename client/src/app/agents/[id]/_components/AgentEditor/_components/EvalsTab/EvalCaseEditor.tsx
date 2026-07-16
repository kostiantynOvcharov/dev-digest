/* EvalCaseEditor — edit one eval case (SPEC-04, AC-14).

   Name + an Input area (Diff / Files / PR-meta tabs) + a user-authored
   `expected_output` JSON area validated with zod `safeParse` at the boundary,
   a "+ Finding skeleton" helper, a "Run on save" toggle, and Cancel / Run /
   Save. `expected_output` and the derived inputs are rendered strictly as TEXT
   (controlled <textarea> / escaped <pre>) — never `dangerouslySetInnerHTML`. */
"use client";

import React from "react";
import { z } from "zod";
import { Button, Tabs, Toggle, Textarea, TextInput } from "@devdigest/ui";
import type { Agent, EvalCase, EvalCaseInput } from "@devdigest/shared";
import { A11yModal } from "@/components/A11yModal";
import { useUpdateEvalCase, useRunEvals } from "@/lib/hooks/eval";
import { isMustNotFlag } from "@/lib/eval-format";

/** One expected finding — kept loose (passthrough) so hand edits aren't rejected. */
const ExpectedFinding = z
  .object({
    file: z.string(),
    start_line: z.number().int(),
    end_line: z.number().int(),
  })
  .passthrough();
/** `expected_output` is an array of expected findings ([] ⇔ must_not_flag). */
const ExpectedOutput = z.array(ExpectedFinding);

const FINDING_SKELETON = {
  file: "src/path/to/file.ts",
  start_line: 1,
  end_line: 1,
  severity: "WARNING",
  category: "bug",
  title: "Describe the expected finding",
};

const INPUT_TABS = [
  { key: "diff", label: "Diff" },
  { key: "files", label: "Files" },
  { key: "meta", label: "PR meta" },
];

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return "null";
  }
}

export function EvalCaseEditor({
  agent,
  evalCase,
  onClose,
}: {
  agent: Agent;
  evalCase: EvalCase;
  onClose: () => void;
}) {
  const update = useUpdateEvalCase("agent", agent.id);
  const run = useRunEvals(agent.id);

  const [name, setName] = React.useState(evalCase.name);
  const [diff, setDiff] = React.useState(evalCase.input_diff);
  const [expectedText, setExpectedText] = React.useState(() => prettyJson(evalCase.expected_output));
  const [runOnSave, setRunOnSave] = React.useState(false);
  const [inputTab, setInputTab] = React.useState("diff");

  // Derived during render — never stored. Validates the user-authored JSON.
  const parsed = React.useMemo(() => {
    let json: unknown;
    try {
      json = JSON.parse(expectedText || "[]");
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Invalid JSON" };
    }
    const result = ExpectedOutput.safeParse(json);
    if (!result.success) {
      return { ok: false as const, error: result.error.issues[0]?.message ?? "Invalid expected output" };
    }
    return { ok: true as const, value: result.data };
  }, [expectedText]);

  const busy = update.isPending || run.isPending;

  const save = async (alsoRun: boolean) => {
    if (!parsed.ok) return;
    const input: EvalCaseInput = {
      owner_kind: evalCase.owner_kind,
      owner_id: evalCase.owner_id,
      name: name.trim() || evalCase.name,
      input_diff: diff,
      input_files: evalCase.input_files,
      input_meta: evalCase.input_meta,
      expected_output: parsed.value,
      notes: evalCase.notes ?? null,
    };
    await update.mutateAsync({ id: evalCase.id, input });
    if (alsoRun || runOnSave) run.mutate();
    onClose();
  };

  const addSkeleton = () => {
    const base = parsed.ok ? parsed.value : [];
    setExpectedText(prettyJson([...base, FINDING_SKELETON]));
  };

  return (
    <A11yModal
      title="Edit eval case"
      subtitle={isMustNotFlag(evalCase) ? "must_not_flag · expected 0 findings" : "must_find case"}
      onClose={onClose}
      width={760}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
            <Toggle on={runOnSave} onChange={setRunOnSave} />
            Run on save
          </label>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            <Button kind="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button kind="secondary" icon="Play" onClick={() => save(true)} disabled={busy || !parsed.ok}>
              Run case
            </Button>
            <Button kind="primary" onClick={() => save(false)} disabled={busy || !parsed.ok}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      }
    >
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
        <label style={{ display: "block" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>Name</span>
          <div style={{ marginTop: 8 }}>
            <TextInput value={name} onChange={setName} placeholder="Eval case name" />
          </div>
        </label>

        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>Input</div>
          <Tabs tabs={INPUT_TABS} value={inputTab} onChange={setInputTab} />
          <div style={{ marginTop: 12 }}>
            {inputTab === "diff" && (
              <Textarea value={diff} onChange={setDiff} rows={10} mono placeholder="Unified diff fragment" />
            )}
            {inputTab === "files" && (
              <pre style={preStyle}>{prettyJson(evalCase.input_files)}</pre>
            )}
            {inputTab === "meta" && (
              <pre style={preStyle}>{prettyJson(evalCase.input_meta)}</pre>
            )}
          </div>
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>Expected output</span>
            <span
              role="status"
              aria-live="polite"
              style={{ fontSize: 12, color: parsed.ok ? "var(--ok)" : "var(--crit)" }}
            >
              {parsed.ok ? "✓ valid JSON" : `✕ ${parsed.error}`}
            </span>
            <Button kind="ghost" size="sm" icon="Plus" onClick={addSkeleton} style={{ marginLeft: "auto" }}>
              Finding skeleton
            </Button>
          </div>
          <Textarea
            value={expectedText}
            onChange={setExpectedText}
            rows={10}
            mono
            placeholder='[] for must_not_flag, or [{ "file": …, "start_line": …, "end_line": … }]'
          />
        </div>
      </div>
    </A11yModal>
  );
}

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: "10px 12px",
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  fontSize: 13,
  lineHeight: 1.5,
  maxHeight: 240,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

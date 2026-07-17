/* EvalCaseEditor — create OR edit one eval case (SPEC-04, AC-14).

   Shared across two flows:
   - CREATE: seeded from a decided PR finding (FindingCard) — `mode="create"`.
   - EDIT: an existing case in the Agent editor's Evals tab — `mode="edit"`.

   A case-kind badge (POSITIVE / NEGATIVE, derived from the CURRENT expected
   output), Name, an Input area (Diff / Files / PR-meta tabs), a user-authored
   `expected_output` JSON area validated with zod `safeParse` at the boundary, a
   "+ Finding skeleton" helper, an ephemeral "Run case" that shows the produced
   actual output + a pass/fail banner, a "Run on save" toggle, and Cancel / Run
   case / Save. `expected_output` and the derived inputs are rendered strictly as
   TEXT (controlled <textarea> / escaped <pre>) — never `dangerouslySetInnerHTML`. */
"use client";

import React from "react";
import { z } from "zod";
import { Button, Tabs, Toggle, Textarea, TextInput } from "@devdigest/ui";
import type { EvalCaseInput, EvalOwnerKind } from "@devdigest/shared";
import { A11yModal } from "@/components/A11yModal";
import {
  useUpdateEvalCase,
  useCreateEvalCaseFromInput,
  useRunEvalCase,
  type EvalRunCaseResult,
} from "@/lib/hooks/eval";
import { isMustNotFlag } from "@/lib/eval-format";
import { formatCost } from "@/lib/cost";

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

export interface EvalCaseEditorInitial {
  name: string;
  input_diff: string;
  input_files: unknown;
  input_meta: unknown;
  expected_output: unknown;
}

export function EvalCaseEditor({
  title,
  subtitle,
  ownerKind,
  ownerId,
  mode,
  editCaseId,
  initial,
  onClose,
}: {
  title: string;
  subtitle: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
  mode: "create" | "edit";
  editCaseId?: string;
  initial: EvalCaseEditorInitial;
  onClose: () => void;
}) {
  const create = useCreateEvalCaseFromInput(ownerKind, ownerId);
  const update = useUpdateEvalCase(ownerKind, ownerId);
  const runCase = useRunEvalCase(ownerId, ownerKind);

  const [name, setName] = React.useState(initial.name);
  const [diff, setDiff] = React.useState(initial.input_diff);
  const [expectedText, setExpectedText] = React.useState(() => prettyJson(initial.expected_output));
  const [runOnSave, setRunOnSave] = React.useState(false);
  const [inputTab, setInputTab] = React.useState("diff");
  const [lastRun, setLastRun] = React.useState<EvalRunCaseResult | null>(null);

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

  // Case kind reflects the CURRENT expected output (empty ⇒ negative/must_not_flag).
  const expected = parsed.ok ? parsed.value : [];
  const negative = isMustNotFlag({ expected_output: expected });
  const firstExpected = expected[0] as
    | { file?: string; start_line?: number; title?: string }
    | undefined;

  const busy = create.isPending || update.isPending || runCase.isPending;

  const buildInput = (): EvalCaseInput => ({
    owner_kind: ownerKind,
    owner_id: ownerId,
    name: name.trim() || initial.name,
    input_diff: diff,
    input_files: initial.input_files ?? null,
    input_meta: initial.input_meta ?? null,
    expected_output: parsed.ok ? parsed.value : [],
    notes: null,
  });

  const runNow = async () => {
    if (!parsed.ok) return;
    const result = await runCase.mutateAsync({
      input_diff: diff,
      input_files: initial.input_files,
      input_meta: initial.input_meta,
      expected_output: parsed.value,
    });
    setLastRun(result);
  };

  const save = async () => {
    if (!parsed.ok) return;
    if (runOnSave) await runNow();
    if (mode === "create") {
      await create.mutateAsync(buildInput());
    } else {
      await update.mutateAsync({ id: editCaseId!, input: buildInput() });
    }
    onClose();
  };

  const addSkeleton = () => {
    const base = parsed.ok ? parsed.value : [];
    setExpectedText(prettyJson([...base, FINDING_SKELETON]));
  };

  return (
    <A11yModal
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      width={760}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {lastRun && <RunBanner run={lastRun} />}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
            <Toggle on={runOnSave} onChange={setRunOnSave} />
            Run on save
          </label>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            <Button kind="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              kind="secondary"
              icon="Play"
              onClick={runNow}
              disabled={!parsed.ok || runCase.isPending}
            >
              {runCase.isPending ? "Running…" : "Run case"}
            </Button>
            <Button kind="primary" onClick={save} disabled={busy || !parsed.ok}>
              {create.isPending || update.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      }
    >
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
        <CaseKindBox negative={negative} first={firstExpected} />

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
            {inputTab === "files" && <pre style={preStyle}>{prettyJson(initial.input_files)}</pre>}
            {inputTab === "meta" && <pre style={preStyle}>{prettyJson(initial.input_meta)}</pre>}
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

        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>
            Actual output
          </div>
          <pre style={preStyle}>
            {lastRun ? prettyJson(lastRun.actual_output) : "Never run yet"}
          </pre>
        </div>
      </div>
    </A11yModal>
  );
}

/** Top-of-editor kind badge: BLUE positive (must_find) / ORANGE negative (must_not_flag). */
function CaseKindBox({
  negative,
  first,
}: {
  negative: boolean;
  first: { file?: string; start_line?: number; title?: string } | undefined;
}) {
  const color = negative ? "var(--warn)" : "var(--accent)";
  const bg = negative ? "var(--warn-bg)" : "var(--accent-bg)";
  const heading = negative ? "NEGATIVE CASE" : "POSITIVE CASE";
  const subtext = negative
    ? "MUST NOT flag"
    : `MUST find "${first?.title ?? "the expected finding"}" at ${first?.file ?? "?"}:${first?.start_line ?? "?"}`;
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 8,
        border: `1px solid ${color}`,
        background: bg,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", color }}>{heading}</div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4, wordBreak: "break-word" }}>
        {subtext}
      </div>
    </div>
  );
}

/** Ephemeral single-case result banner (green pass / red fail / amber errored). */
function RunBanner({ run }: { run: EvalRunCaseResult }) {
  const secs = (run.duration_ms / 1000).toFixed(1);
  const cost = formatCost(run.cost_usd);
  let color = "var(--warn)";
  let label = `Last run errored · 0/1 passed · ${secs}s · ${cost}`;
  if (run.pass === true) {
    color = "var(--ok)";
    label = `Last run passed · 1/1 passed · ${secs}s · ${cost}`;
  } else if (run.pass === false) {
    color = "var(--crit)";
    label = `Last run failed · 0/1 passed · ${secs}s · ${cost}`;
  }
  return (
    <span role="status" aria-live="polite" style={{ fontSize: 12, fontWeight: 600, color }}>
      {label}
    </span>
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

/* EvalDashboardView — the Eval Dashboard page shell (SPEC-04, AC-11 UI).

   Owns the AppShell chrome and the selected-owner URL state (`?owner=`), then
   delegates to the all-agents overview or one agent's detail. App-router keeps
   `app/` for routing only — all logic lives here and in the hooks. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgents } from "@/lib/hooks/agents";
import { AllAgentsOverview } from "../AllAgentsOverview";
import { AgentEvalDetail } from "../AgentEvalDetail";

export function EvalDashboardView() {
  const router = useRouter();
  const search = useSearchParams();
  const ownerId = search.get("owner");

  const { data: agents } = useAgents();
  const selectedAgent = ownerId ? agents?.find((a) => a.id === ownerId) : undefined;

  const select = (id: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (id) sp.set("owner", id);
    else sp.delete("owner");
    router.replace(sp.toString() ? `/evals?${sp.toString()}` : "/evals");
  };

  const crumb = [
    { label: "Skills Lab" },
    { label: "Eval Dashboard", href: "/evals" },
    ...(selectedAgent ? [{ label: selectedAgent.name }] : []),
  ];

  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: "24px 32px 40px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          {selectedAgent && (
            <Button kind="ghost" size="sm" icon="ChevronLeft" onClick={() => select(null)}>
              All agents
            </Button>
          )}
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>
            {selectedAgent ? `${selectedAgent.name} · Evals` : "Eval Dashboard"}
          </h1>
        </div>

        {selectedAgent ? (
          <AgentEvalDetail agent={selectedAgent} />
        ) : (
          <AllAgentsOverview onSelect={(id) => select(id)} />
        )}
      </div>
    </AppShell>
  );
}

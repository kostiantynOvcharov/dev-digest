import { Suspense } from "react";
import { EvalDashboardView } from "./_components/EvalDashboardView";

/* Route: /evals (SKILLS LAB › Eval Dashboard). Thin route entry — the view,
   its overview/detail leaves, the Compare modal, hooks and formatting live under
   _components/ and src/lib/hooks/eval.ts. Wrapped in Suspense because the view
   reads `?owner=` via useSearchParams (App Router CSR-bailout requirement). */
export default function EvalDashboardPage() {
  return (
    <Suspense fallback={null}>
      <EvalDashboardView />
    </Suspense>
  );
}

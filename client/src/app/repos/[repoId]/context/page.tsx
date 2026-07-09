import { ProjectContextView } from "./_components/ProjectContextView";

/* Route: /repos/:repoId/context (WORKSPACE › Project Context). Thin route entry —
   the view, its list/preview leaves, styles, hooks and i18n are colocated under
   _components/ and src/lib/hooks/context.ts. */
export default function ProjectContextPage() {
  return <ProjectContextView />;
}

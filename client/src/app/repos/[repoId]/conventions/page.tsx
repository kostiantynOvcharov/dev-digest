import { ConventionsView } from "./_components/ConventionsView";

/* Route: /repos/:repoId/conventions (Conventions Extractor). Thin route entry —
   the view, its cards, create-skill modal, styles and i18n are colocated under
   _components/. */
export default function ConventionsPage() {
  return <ConventionsView />;
}

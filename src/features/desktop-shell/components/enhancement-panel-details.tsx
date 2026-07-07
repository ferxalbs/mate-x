import type { EvidencePack } from "../../../contracts/chat";
import type { RepoHealthSignal } from "./enhancement-panel-utils";
import type { WorkspaceSummary } from "../../../contracts/workspace";
import { ValidationSection } from "./enhancement-panel-validation";
import { RepoHealthSection } from "./enhancement-panel-health";

export function DetailsSection({
  commands,
  evidencePack,
  hasProfile,
  nextAction,
  signals,
  tests,
  workspace,
}: {
  commands: string[];
  evidencePack: EvidencePack | null;
  hasProfile: boolean;
  nextAction?: string;
  signals: RepoHealthSignal[];
  tests: string[];
  workspace?: WorkspaceSummary | null;
}) {
  return (
    <section className="space-y-4">
      <ValidationSection commands={commands} evidencePack={evidencePack} tests={tests} />
      <RepoHealthSection
        hasWorkspace={Boolean(workspace)}
        hasProfile={hasProfile}
        workspace={workspace}
        signals={signals}
        nextAction={nextAction}
      />
    </section>
  );
}

import type { Dispatch, SetStateAction } from 'react';
import { ShieldCheckIcon } from 'lucide-react';

import { SettingsRow, SettingsSection } from '../components/ui/settings-layout';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import type {
  WorkspaceTrustAutonomy,
  WorkspaceTrustContract,
} from '../contracts/workspace';
import { TrustTextareaRow, formatDateTime } from './settings-page-utils';

interface SettingsTrustSectionProps {
  activeWorkspaceName?: string;
  trustDraft: WorkspaceTrustContract | null;
  setTrustDraft: Dispatch<SetStateAction<WorkspaceTrustContract | null>>;
  setIsUnrestrictedDialogOpen: (value: boolean) => void;
}

export function SettingsTrustSection({
  activeWorkspaceName,
  trustDraft,
  setTrustDraft,
  setIsUnrestrictedDialogOpen,
}: SettingsTrustSectionProps) {
  return (
    <SettingsSection title="Workspace Trust Contract" icon={<ShieldCheckIcon className="size-3.5" />}>
      {trustDraft ? (
        <>
          <SettingsRow
            title="Operational profile"
            description={`Versioned contract for ${activeWorkspaceName ?? 'the active workspace'}. This profile is sent into each run and enforced before tool execution.`}
            status={`Updated ${formatDateTime(trustDraft.updatedAt)}`}
            control={
              <Select
                value={trustDraft.autonomy}
                onValueChange={(value) => {
                  const nextAutonomy = value as WorkspaceTrustAutonomy;
                  if (nextAutonomy === 'unrestricted') {
                    setIsUnrestrictedDialogOpen(true);
                    return;
                  }

                  setTrustDraft((draft) =>
                    draft
                      ? {
                          ...draft,
                          autonomy: nextAutonomy,
                        }
                      : draft,
                  );
                }}
              >
                <SelectTrigger className="w-[190px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plan-only">Plan only</SelectItem>
                  <SelectItem value="approval-required">Approval required</SelectItem>
                  <SelectItem value="trusted-patch">Trusted patch</SelectItem>
                  <SelectItem value="unrestricted">Unrestricted</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <TrustTextareaRow
            title="Scope"
            description="Folders and files the agent can inspect or modify when a tool accepts a path."
            value={trustDraft.allowedPaths}
            onChange={(allowedPaths) =>
              setTrustDraft((draft) => draft ? { ...draft, allowedPaths } : draft)
            }
          />
          <TrustTextareaRow
            title="Forbidden"
            description="Paths that remain blocked even when they sit under an allowed folder."
            value={trustDraft.forbiddenPaths}
            onChange={(forbiddenPaths) =>
              setTrustDraft((draft) => draft ? { ...draft, forbiddenPaths } : draft)
            }
          />
          <TrustTextareaRow
            title="Commands"
            description="Exact command prefixes allowed for controlled execution tools."
            value={trustDraft.allowedCommands}
            onChange={(allowedCommands) =>
              setTrustDraft((draft) => draft ? { ...draft, allowedCommands } : draft)
            }
          />
          <TrustTextareaRow
            title="Network"
            description="Domains the main process may query during governed runs."
            value={trustDraft.allowedDomains}
            onChange={(allowedDomains) =>
              setTrustDraft((draft) => draft ? { ...draft, allowedDomains } : draft)
            }
          />
          <TrustTextareaRow
            title="Secrets"
            description="Secret labels available to runs. Empty means no workspace secrets are released."
            value={trustDraft.allowedSecrets}
            placeholder="none"
            onChange={(allowedSecrets) =>
              setTrustDraft((draft) => draft ? { ...draft, allowedSecrets } : draft)
            }
          />
          <TrustTextareaRow
            title="Allowed actions"
            description="Action classes the tool loop may perform inside this workspace."
            value={trustDraft.allowedActions}
            onChange={(allowedActions) =>
              setTrustDraft((draft) => draft ? { ...draft, allowedActions } : draft)
            }
          />
          <TrustTextareaRow
            title="Blocked actions"
            description="High-risk action classes the contract rejects before execution."
            value={trustDraft.blockedActions}
            onChange={(blockedActions) =>
              setTrustDraft((draft) => draft ? { ...draft, blockedActions } : draft)
            }
          />
        </>
      ) : (
        <SettingsRow
          title="No active workspace"
          description="Import or activate a workspace before editing its trust contract."
          control={null}
        />
      )}
    </SettingsSection>
  );
}

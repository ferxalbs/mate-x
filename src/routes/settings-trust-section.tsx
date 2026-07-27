import { HugeiconsIcon } from "@hugeicons/react";
import type { Dispatch, SetStateAction } from 'react';
import { ShieldKeyIcon } from '@hugeicons/core-free-icons';

import { SettingsRow, SettingsSection } from '../components/ui/settings-layout';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import type {
  WorkspaceWriteAccess,
  WorkspaceTrustContract,
} from '../contracts/workspace';
import { TrustTextareaRow, formatDateTime } from './settings-page-utils';

interface SettingsTrustSectionProps {
  activeWorkspaceName?: string;
  trustDraft: WorkspaceTrustContract | null;
  setTrustDraft: Dispatch<SetStateAction<WorkspaceTrustContract | null>>;
}

export function SettingsTrustSection({
  activeWorkspaceName,
  trustDraft,
  setTrustDraft,
}: SettingsTrustSectionProps) {
  return (
    <SettingsSection title="Workspace Policy" icon={<HugeiconsIcon icon={ShieldKeyIcon} className="size-4" />}>
      {trustDraft ? (
        <>
          <SettingsRow
            title="Operational profile"
            description={`Capability limits for ${activeWorkspaceName ?? 'the active workspace'}. These rules are enforced before actions run.`}
            status={`Updated ${formatDateTime(trustDraft.updatedAt)}`}
            control={
              <Select
                value={trustDraft.writeAccess}
                onValueChange={(value) => {
                  const nextWriteAccess = value as WorkspaceWriteAccess;
                  setTrustDraft((draft) =>
                    draft
                      ? {
                          ...draft,
                          writeAccess: nextWriteAccess,
                        }
                      : draft,
                  );
                }}
              >
                <SelectTrigger className="w-full sm:w-[190px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="read-only">Read only</SelectItem>
                  <SelectItem value="approval-required">Ask before changes</SelectItem>
                  <SelectItem value="workspace">Workspace changes</SelectItem>
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
          description="Import or activate a workspace before editing its policy."
          control={null}
        />
      )}
    </SettingsSection>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { BrainCircuitIcon, Loader2Icon, RouteIcon } from 'lucide-react';

import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SettingsRow, SettingsSection } from '../../components/ui/settings-layout';
import { Switch } from '../../components/ui/switch';
import type {
  AgentCapabilityProfile,
  AgentRoutingRecommendation,
} from '../../contracts/agent-capability-profiler';
import type { AppSettings } from '../../contracts/settings';
import {
  getAgentCapabilityProfiles,
  getAgentRoutingRecommendation,
} from '../../services/repo-client';

interface AgentProfilerSettingsProps {
  activeWorkspaceId: string | null;
  appSettings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  isBusy: boolean;
}

export function AgentProfilerSettings({
  activeWorkspaceId,
  appSettings,
  onSettingsChange,
  isBusy,
}: AgentProfilerSettingsProps) {
  const [profiles, setProfiles] = useState<AgentCapabilityProfile[]>([]);
  const [task, setTask] = useState('fix failing tests in this workspace');
  const [recommendation, setRecommendation] =
    useState<AgentRoutingRecommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [recommending, setRecommending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadProfiles() {
      setLoading(true);
      setError('');
      try {
        const nextProfiles = await getAgentCapabilityProfiles(
          activeWorkspaceId ?? undefined,
        );
        if (!cancelled) {
          setProfiles(nextProfiles);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load profiler data.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadProfiles();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);

  const workspaceProfiles = useMemo(
    () => profiles.filter((profile) => profile.workspaceId),
    [profiles],
  );
  const globalProfiles = useMemo(
    () => profiles.filter((profile) => !profile.workspaceId),
    [profiles],
  );

  async function handleRecommend() {
    if (!task.trim()) {
      return;
    }
    setRecommending(true);
    setError('');
    try {
      setRecommendation(
        await getAgentRoutingRecommendation(task.trim(), activeWorkspaceId ?? undefined),
      );
    } catch (recommendError) {
      setError(recommendError instanceof Error ? recommendError.message : 'Could not build recommendation.');
    } finally {
      setRecommending(false);
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Agent Profiler"
        icon={<BrainCircuitIcon className="size-3.5" />}
        headerAction={
          loading ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2Icon className="size-3 animate-spin" />
              Loading
            </span>
          ) : null
        }
      >
        <>
          <SettingsRow
            title="Routing recommendations"
            description="Compare model behavior from verified repo tasks and recommend best model for next task."
            status={
              recommendation ? (
                <span className="text-foreground/80">{recommendation.reason}</span>
              ) : error ? (
                <span className="text-destructive-foreground">{error}</span>
              ) : (
                <span>{profiles.length} model profile(s) available.</span>
              )
            }
            control={
              <Switch
                checked={appSettings.agentProfilerAutoSwitch}
                disabled={isBusy}
                onCheckedChange={(value) =>
                  onSettingsChange({
                    ...appSettings,
                    agentProfilerAutoSwitch: value,
                  })
                }
              />
            }
          >
            <div className="mt-4 flex flex-col gap-2 pb-4 sm:flex-row">
              <Input
                nativeInput
                value={task}
                onChange={(event) => setTask(event.target.value)}
                placeholder="Describe task to route"
                className="min-w-0 flex-1"
              />
              <Button
                size="sm"
                className="h-9 rounded-lg"
                disabled={recommending || task.trim().length === 0}
                onClick={() => void handleRecommend()}
              >
                {recommending ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <RouteIcon className="size-4" />
                )}
                Recommend
              </Button>
            </div>
          </SettingsRow>
          <SettingsRow
            title="Auto-switch"
            description="When off, MaTE X only recommends. It never changes model without user setting."
            status={
              appSettings.agentProfilerAutoSwitch
                ? 'Enabled for future routing flows.'
                : 'Off. Recommendations are advisory only.'
            }
          />
        </>
      </SettingsSection>

      <ProfilerTable title="Workspace model behavior" profiles={workspaceProfiles} />
      <ProfilerTable title="Global model behavior" profiles={globalProfiles} />
    </div>
  );
}

function ProfilerTable({
  title,
  profiles,
}: {
  title: string;
  profiles: AgentCapabilityProfile[];
}) {
  return (
    <SettingsSection title={title} icon={<RouteIcon className="size-3.5" />}>
      {profiles.length === 0 ? (
        <SettingsRow
          title="No data yet"
          description="Run real assistant tasks with tools, patches, or validation to build this profile."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-xs">
            <thead className="border-b border-border/60 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-3 py-3 font-medium">Tasks</th>
                <th className="px-3 py-3 font-medium">Tools</th>
                <th className="px-3 py-3 font-medium">Invalid</th>
                <th className="px-3 py-3 font-medium">Iter</th>
                <th className="px-3 py-3 font-medium">Patch</th>
                <th className="px-3 py-3 font-medium">Validation</th>
                <th className="px-3 py-3 font-medium">Halluc.</th>
                <th className="px-3 py-3 font-medium">Tokens</th>
                <th className="px-4 py-3 font-medium">Tags</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr
                  key={`${profile.workspaceId ?? 'global'}:${profile.model}`}
                  className="border-b border-border/50 last:border-0"
                >
                  <td className="max-w-[220px] truncate px-4 py-3 font-medium text-foreground">
                    {profile.model}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {profile.totals.taskCount}
                  </td>
                  <td className="px-3 py-3">{percent(profile.toolCallSuccessRate)}</td>
                  <td className="px-3 py-3">{percent(profile.invalidToolCallRate)}</td>
                  <td className="px-3 py-3">
                    {profile.averageIterations.toFixed(1)}
                  </td>
                  <td className="px-3 py-3">
                    {attemptRate(
                      profile.patchSuccessRate,
                      profile.totals.patchAttemptCount,
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {attemptRate(
                      profile.validationPassRate,
                      profile.totals.validationAttemptCount,
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {profile.totals.hallucinatedFilePathCount}
                  </td>
                  <td className="px-3 py-3">
                    {Math.round(profile.averageTokensPerVerifiedTask).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {profile.tags.length > 0 ? (
                        profile.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground">No tags yet</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SettingsSection>
  );
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function attemptRate(value: number, attempts: number) {
  return attempts > 0 ? percent(value) : 'N/A';
}

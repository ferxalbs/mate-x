import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  FolderOpenIcon,
  KeyIcon,
  LockKeyIcon,
  MonitorIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import type {
  AppearancePreference,
  AppSettings,
} from "../../contracts/settings";
import type {
  PrivacyModelDownloadProgress,
  PrivacyModelStatus,
} from "../../contracts/privacy";
import type {
  WorkspaceTrustAutonomy,
  WorkspaceTrustContract,
} from "../../contracts/workspace";

interface PreferencesStepProps {
  settings: AppSettings;
  onAppearanceChange: (appearance: AppearancePreference) => void;
}

export function WelcomeStep() {
  return (
    <section className="flex min-h-64 flex-col justify-center py-8 text-center sm:py-12">
      <p className="text-[36px] font-semibold leading-none tracking-[-0.04em] text-foreground sm:text-[40px]">
        MaTE X
      </p>
      <h2 className="mx-auto mt-6 max-w-xl text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-[28px]">
        The trust layer for AI-written code.
      </h2>
      <p className="mx-auto mt-4 max-w-lg text-[15px] leading-6 text-muted-foreground">
        Review repository risk, keep changes inside explicit boundaries, and
        preserve local evidence before code moves forward.
      </p>
    </section>
  );
}

export function PreferencesStep({
  settings,
  onAppearanceChange,
}: PreferencesStepProps) {
  return (
    <StepPanel icon={<MonitorIcon />} title="Appearance">
      <p className="text-[15px] leading-6 text-muted-foreground">
        Match macOS automatically or choose a fixed appearance. Other interface
        details remain available in Settings.
      </p>
      <div className="mt-6 max-w-sm space-y-2">
        <Label htmlFor="onboarding-appearance">Interface appearance</Label>
        <Select
          value={settings.appearance}
          onValueChange={(value) =>
            onAppearanceChange(value as AppearancePreference)
          }
        >
          <SelectTrigger
            aria-label="Interface appearance"
            className="w-full"
            id="onboarding-appearance"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">System (recommended)</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </StepPanel>
  );
}

interface PrivacyStepProps {
  getModelStatus: () => Promise<PrivacyModelStatus>;
  downloadModel: () => Promise<PrivacyModelStatus>;
  onModelDownloadProgress: (
    callback: (progress: PrivacyModelDownloadProgress) => void,
  ) => () => void;
}

export function PrivacyStep({
  getModelStatus,
  downloadModel,
  onModelDownloadProgress,
}: PrivacyStepProps) {
  const [status, setStatus] = useState<PrivacyModelStatus | null>(null);
  const [progress, setProgress] =
    useState<PrivacyModelDownloadProgress | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getModelStatus()
      .then((nextStatus) => {
        if (!cancelled) setStatus(nextStatus);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Privacy model status is unavailable. You can continue safely.");
        }
      });
    const unsubscribe = onModelDownloadProgress((nextProgress) => {
      if (!cancelled) setProgress(nextProgress);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [getModelStatus, onModelDownloadProgress]);

  const isReady = status?.inferenceReady || progress?.state === "ready";
  const isDownloading =
    progress?.state === "downloading" || progress?.state === "verifying";
  const percent = Math.max(0, Math.min(100, progress?.percent ?? 0));

  async function handleDownload() {
    setError("");
    try {
      const nextStatus = await downloadModel();
      setStatus(nextStatus);
    } catch (downloadError) {
      setError(toErrorMessage(downloadError, "Could not install the privacy model."));
    }
  }

  return (
    <StepPanel icon={<ShieldCheckIcon />} title="Local privacy scan">
      <p className="text-[15px] leading-6 text-muted-foreground">
        Built-in checks remain active. The optional local model adds secret and
        PII classification before cloud reasoning and can also be installed later.
      </p>
      <div className="mt-6 flex flex-col gap-4 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">
            {isReady
              ? "Privacy model ready"
              : isDownloading
                ? progress?.state === "verifying"
                  ? "Verifying local model"
                  : "Downloading local model"
                : "Optional local model"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
            {isDownloading ? `${Math.round(percent)}% complete` : "About 340 MB"}
          </p>
        </div>
        <Button
          disabled={Boolean(isReady || isDownloading)}
          onClick={() => void handleDownload()}
          type="button"
          variant="outline"
        >
          {isReady ? (
            <CheckCircleIcon className="size-4" />
          ) : (
            <DownloadSimpleIcon className="size-4" />
          )}
          {isReady ? "Installed" : isDownloading ? "Installing" : "Install model"}
        </Button>
      </div>
      {isDownloading ? (
        <div
          aria-label={`Privacy model download ${Math.round(percent)}%`}
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(percent)}
        >
          <div
            className="h-full origin-left bg-primary transition-transform duration-200 ease-out"
            style={{ transform: `scaleX(${percent / 100})` }}
          />
        </div>
      ) : null}
      {error ? <InlineError message={error} /> : null}
    </StepPanel>
  );
}

interface ApiKeyStepProps {
  apiKey: string;
  apiKeyConfigured: boolean;
  onApiKeyChange: (value: string) => void;
}

export function ApiKeyStep({
  apiKey,
  apiKeyConfigured,
  onApiKeyChange,
}: ApiKeyStepProps) {
  return (
    <StepPanel icon={<KeyIcon />} title="Rainy API key">
      <p className="text-[15px] leading-6 text-muted-foreground">
        Your key is stored by the main process and never embedded in repository
        evidence. You can leave this blank and configure it later.
      </p>
      <div className="mt-6 max-w-lg space-y-2">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="onboarding-api-key">API key</Label>
          {apiKeyConfigured ? (
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              Configured
            </span>
          ) : null}
        </div>
        <Input
          autoComplete="off"
          id="onboarding-api-key"
          nativeInput
          onChange={(event) => onApiKeyChange(event.target.value)}
          placeholder="ra-…"
          type="password"
          value={apiKey}
        />
      </div>
      <a
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
        href="https://app.rainy-mate.com"
        rel="noreferrer"
        target="_blank"
      >
        Get a Rainy API key
        <ArrowSquareOutIcon className="size-4" />
      </a>
    </StepPanel>
  );
}

export function WorkspaceStep({
  selectedWorkspace,
}: {
  selectedWorkspace: string | null;
}) {
  return (
    <StepPanel icon={<FolderOpenIcon />} title="Local repository">
      <p className="text-[15px] leading-6 text-muted-foreground">
        The picker opens a local folder. MaTE X builds repository context on this
        device and scopes subsequent tools to that workspace.
      </p>
      <div className="mt-6 border-t border-border/70 pt-5">
        <p className="text-sm font-medium text-foreground">Selected repository</p>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {selectedWorkspace ?? "No repository selected yet."}
        </p>
      </div>
    </StepPanel>
  );
}

interface TrustBoundaryStepProps {
  trustDraft: WorkspaceTrustContract | null;
  onTrustChange: (autonomy: WorkspaceTrustAutonomy) => void;
}

const TRUST_DESCRIPTIONS: Record<WorkspaceTrustAutonomy, string> = {
  "plan-only": "Inspect and propose work without changing files.",
  "approval-required": "Inspect freely and ask before edits or controlled execution.",
  "trusted-patch": "Allow listed workspace edits while risky and Git actions stay gated.",
};

export function TrustBoundaryStep({
  trustDraft,
  onTrustChange,
}: TrustBoundaryStepProps) {
  return (
    <StepPanel icon={<LockKeyIcon />} title="Scoped autonomy">
      {trustDraft ? (
        <>
          <p className="text-[15px] leading-6 text-muted-foreground">
            The repository contract already contains path, command, domain, and
            blocked-action rules. Advanced lists remain available in Settings.
          </p>
          <div className="mt-6 max-w-lg space-y-2">
            <Label htmlFor="onboarding-trust">Workspace behavior</Label>
            <Select
              onValueChange={(value) =>
                onTrustChange(value as WorkspaceTrustAutonomy)
              }
              value={trustDraft.autonomy}
            >
              <SelectTrigger
                aria-label="Workspace behavior"
                className="w-full"
                id="onboarding-trust"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="plan-only">Plan only</SelectItem>
                <SelectItem value="approval-required">Ask before changes</SelectItem>
                <SelectItem value="trusted-patch">Scoped changes</SelectItem>
              </SelectContent>
            </Select>
            <p className="pt-1 text-sm leading-5 text-muted-foreground">
              {TRUST_DESCRIPTIONS[trustDraft.autonomy]}
            </p>
          </div>
        </>
      ) : (
        <InlineError message="Select a repository before setting its boundary." />
      )}
    </StepPanel>
  );
}

export function VerificationStep() {
  return (
    <StepPanel icon={<CheckCircleIcon />} title="Setup complete">
      <p className="text-[15px] leading-6 text-muted-foreground">
        MaTE X will open your workspace with scoped controls active. Start with a
        review request when you are ready; no verification runs automatically.
      </p>
      <ul className="mt-6 space-y-3 border-t border-border/70 pt-5 text-sm text-foreground">
        <li className="flex items-start gap-2.5">
          <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-primary" />
          Local workspace selected
        </li>
        <li className="flex items-start gap-2.5">
          <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-primary" />
          Scoped trust contract ready
        </li>
        <li className="flex items-start gap-2.5">
          <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-primary" />
          Privacy checks remain under your control
        </li>
      </ul>
    </StepPanel>
  );
}

function StepPanel({
  children,
  icon,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-[32px] border border-border/70 bg-background p-6 shadow-none sm:p-8">
      <div className="flex items-center gap-2.5 text-foreground">
        <span className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary [&>svg]:size-4">
          {icon}
        </span>
        <h3 className="text-base font-semibold">{title}</h3>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function InlineError({ message }: { message: string }) {
  return (
    <p
      className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm leading-5 text-destructive"
      role="alert"
    >
      {message}
    </p>
  );
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

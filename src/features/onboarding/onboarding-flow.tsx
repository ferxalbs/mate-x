import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, Loading02Icon } from "@hugeicons/core-free-icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  useReducedMotion,
} from "framer-motion";

import { useNavigate } from "@tanstack/react-router";

import { Button } from "../../components/ui/button";
import type { ApiKeyStatus } from "../../contracts/ipc";
import type {
  PrivacyModelDownloadProgress,
  PrivacyModelStatus,
} from "../../contracts/privacy";
import type {
  AppearancePreference,
  AppSettings,
} from "../../contracts/settings";
import type {
  WorkspaceSnapshot,
  WorkspaceTrustAutonomy,
  WorkspaceTrustContract,
} from "../../contracts/workspace";
import { useTheme } from "../../hooks/use-theme";
import {
  getApiKeyStatus,
  getAppSettings,
  updateAppSettings,
} from "../../services/settings-client";
import {
  ApiKeyStep,
  InlineError,
  PreferencesStep,
  PrivacyStep,
  TrustBoundaryStep,
  VerificationStep,
  WelcomeStep,
  WorkspaceStep,
} from "./onboarding-step-content";
import {
  getOnboardingMotion,
  ONBOARDING_STEPS,
  type OnboardingOperationState,
  type OnboardingStepId,
} from "./onboarding-steps";

export interface OnboardingServices {
  getAppSettings: () => Promise<AppSettings>;
  updateAppSettings: (settings: AppSettings) => Promise<AppSettings>;
  getApiKeyStatus: () => Promise<ApiKeyStatus>;
  setApiKey: (apiKey: string) => Promise<void>;
  openWorkspacePicker: () => Promise<WorkspaceSnapshot | null>;
  updateWorkspaceTrustContract: (
    contract: WorkspaceTrustContract,
  ) => Promise<WorkspaceTrustContract>;
  getPrivacyModelStatus: () => Promise<PrivacyModelStatus>;
  downloadPrivacyModel: () => Promise<PrivacyModelStatus>;
  onPrivacyModelDownloadProgress: (
    callback: (progress: PrivacyModelDownloadProgress) => void,
  ) => () => void;
}

const DEFAULT_ONBOARDING_SERVICES: OnboardingServices = {
  getAppSettings,
  updateAppSettings,
  getApiKeyStatus,
  setApiKey: (apiKey) => window.mate.settings.setApiKey(apiKey),
  openWorkspacePicker: () => window.mate.repo.openWorkspacePicker(),
  updateWorkspaceTrustContract: (contract) =>
    window.mate.repo.updateWorkspaceTrustContract(contract),
  getPrivacyModelStatus: () => window.mate.privacy.getModelStatus(),
  downloadPrivacyModel: () => window.mate.privacy.downloadModel(),
  onPrivacyModelDownloadProgress: (callback) =>
    window.mate.privacy.onModelDownloadProgress(callback),
};

const NOOP_APPEARANCE_PREVIEW = () => undefined;

export function OnboardingFlow() {
  const navigate = useNavigate();
  const { setAppearance } = useTheme();

  return (
    <OnboardingFlowContent
      onAppearancePreview={setAppearance}
      onComplete={() => navigate({ to: "/", replace: true })}
    />
  );
}

export function OnboardingFlowContent({
  onAppearancePreview = NOOP_APPEARANCE_PREVIEW,
  onComplete,
  services = DEFAULT_ONBOARDING_SERVICES,
}: {
  onAppearancePreview?: (appearance: AppearancePreference) => void;
  onComplete: () => Promise<void> | void;
  services?: OnboardingServices;
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(
    null,
  );
  const [trustDraft, setTrustDraft] =
    useState<WorkspaceTrustContract | null>(null);
  const [operationState, setOperationState] =
    useState<OnboardingOperationState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const reducedMotion = Boolean(useReducedMotion());

  useEffect(() => {
    let cancelled = false;
    setOperationState("saving");
    setErrorMessage("");

    void Promise.all([services.getAppSettings(), services.getApiKeyStatus()])
      .then(([storedSettings, keyStatus]) => {
        if (cancelled) return;
        const onboardingSettings = {
          ...storedSettings,
          appearance: "system" as const,
        };
        setSettings(onboardingSettings);
        setApiKeyConfigured(keyStatus.configured);
        onAppearancePreview(onboardingSettings.appearance);
        setOperationState("idle");
      })
      .catch((error) => {
        if (cancelled) return;
        setErrorMessage(
          toErrorMessage(error, "Could not load onboarding settings."),
        );
        setOperationState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [loadAttempt, onAppearancePreview, services]);

  useEffect(() => {
    if (settings) headingRef.current?.focus();
  }, [currentStep, settings]);

  const step = ONBOARDING_STEPS[currentStep];
  const motion = useMemo(
    () => getOnboardingMotion(reducedMotion, direction),
    [direction, reducedMotion],
  );
  const isSaving = operationState === "saving";

  const advance = useCallback(() => {
    setDirection(1);
    setCurrentStep((index) => Math.min(index + 1, ONBOARDING_STEPS.length - 1));
  }, []);

  const handleBack = useCallback(() => {
    if (isSaving || currentStep === 0) return;
    setErrorMessage("");
    setOperationState("idle");
    setDirection(-1);
    setCurrentStep((index) => Math.max(0, index - 1));
  }, [currentStep, isSaving]);

  const handlePrimaryAction = useCallback(async () => {
    if (!settings || isSaving) return;

    setErrorMessage("");
    setOperationState("saving");

    try {
      if (step.id === "preferences") {
        const savedSettings = await services.updateAppSettings(settings);
        setSettings(savedSettings);
      } else if (step.id === "api-key" && apiKey.trim()) {
        await services.setApiKey(apiKey.trim());
        setApiKeyConfigured(true);
      } else if (step.id === "workspace") {
        const workspace = await services.openWorkspacePicker();
        if (!workspace) {
          setOperationState("idle");
          return;
        }
        if (!workspace.workspace || !workspace.trustContract) {
          throw new Error("Could not load the selected repository boundary.");
        }
        setSelectedWorkspace(
          workspace.workspace.name ||
            workspace.workspace.path ||
            workspace.workspace.id,
        );
        setTrustDraft(workspace.trustContract);
      } else if (step.id === "trust") {
        if (!trustDraft) {
          throw new Error("Select a repository before saving its boundary.");
        }
        const savedContract =
          await services.updateWorkspaceTrustContract(trustDraft);
        setTrustDraft(savedContract);
      } else if (step.id === "verification") {
        const completedSettings = await services.updateAppSettings({
          ...settings,
          onboardingCompleted: true,
        });
        setSettings(completedSettings);
        await onComplete();
        setOperationState("idle");
        return;
      }

      advance();
      setOperationState("idle");
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Could not save this step."));
      setOperationState("error");
    }
  }, [
    advance,
    apiKey,
    isSaving,
    onComplete,
    services,
    settings,
    step.id,
    trustDraft,
  ]);

  function handleAppearanceChange(appearance: AppearancePreference) {
    setSettings((current) =>
      current ? { ...current, appearance } : current,
    );
    onAppearancePreview(appearance);
  }

  function handleTrustChange(autonomy: WorkspaceTrustAutonomy) {
    setTrustDraft((current) =>
      current ? { ...current, autonomy } : current,
    );
  }

  if (!settings) {
    return (
      <div className="mx-auto flex min-h-80 w-full max-w-2xl flex-col items-center justify-center px-5 text-center">
        <p className="text-2xl font-semibold tracking-[-0.03em] text-foreground">
          MaTE X
        </p>
        {operationState === "error" ? (
          <>
            <InlineError message={errorMessage} />
            <Button
              className="mt-4"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
              type="button"
              variant="outline"
            >
              Try again
            </Button>
          </>
        ) : (
          <div
            aria-live="polite"
            className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <HugeiconsIcon icon={Loading02Icon} className="size-4" />
            Loading setup…
          </div>
        )}
      </div>
    );
  }

  const progress = ((currentStep + 1) / ONBOARDING_STEPS.length) * 100;

  return (
    <LazyMotion features={domAnimation} strict>
      <form
        className="mx-auto flex w-full max-w-[680px] flex-col py-6 sm:py-8"
        onSubmit={(event) => {
          event.preventDefault();
          void handlePrimaryAction();
        }}
      >
        <header>
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-medium text-foreground">
              Step {currentStep + 1} of {ONBOARDING_STEPS.length}
            </span>
            <span className="text-muted-foreground">MaTE X setup</span>
          </div>
          <div
            aria-label={`Onboarding progress: step ${currentStep + 1} of ${ONBOARDING_STEPS.length}`}
            aria-valuemax={ONBOARDING_STEPS.length}
            aria-valuemin={1}
            aria-valuenow={currentStep + 1}
            className="mt-3 h-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
          >
            <div
              className="h-full origin-left bg-primary transition-transform duration-200 ease-out motion-reduce:transition-none"
              style={{ transform: `scaleX(${progress / 100})` }}
            />
          </div>
          <h1
            className="mt-7 text-xl font-semibold tracking-[-0.02em] text-foreground outline-none"
            ref={headingRef}
            tabIndex={-1}
          >
            {step.title}
          </h1>
          <p className="mt-1.5 text-[15px] leading-6 text-muted-foreground">
            {step.description}
          </p>
        </header>

        <div className="relative mt-6 min-h-64">
          <AnimatePresence initial={false} mode="wait">
            <m.div
              animate="center"
              className="w-full"
              exit="exit"
              initial="enter"
              key={step.id}
              transition={motion.transition}
              variants={motion.variants}
            >
              <StepContent
                apiKey={apiKey}
                apiKeyConfigured={apiKeyConfigured}
                onApiKeyChange={setApiKey}
                onAppearanceChange={handleAppearanceChange}
                onTrustChange={handleTrustChange}
                selectedWorkspace={selectedWorkspace}
                services={services}
                settings={settings}
                stepId={step.id}
                trustDraft={trustDraft}
              />
            </m.div>
          </AnimatePresence>
        </div>

        {errorMessage ? <InlineError message={errorMessage} /> : null}

        <footer className="mt-7 flex items-center justify-between gap-4 border-t border-border/70 pt-5">
          <Button
            disabled={currentStep === 0 || isSaving}
            onClick={handleBack}
            type="button"
            variant="ghost"
          >
            Back
          </Button>
          <Button disabled={isSaving} type="submit">
            {isSaving ? (
              <HugeiconsIcon icon={Loading02Icon} className="size-4 animate-spin motion-reduce:animate-none" />
            ) : null}
            {isSaving ? "Saving…" : step.cta}
            {!isSaving ? <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" /> : null}
          </Button>
        </footer>
      </form>
    </LazyMotion>
  );
}

interface StepContentProps {
  apiKey: string;
  apiKeyConfigured: boolean;
  onApiKeyChange: (value: string) => void;
  onAppearanceChange: (appearance: AppearancePreference) => void;
  onTrustChange: (autonomy: WorkspaceTrustAutonomy) => void;
  selectedWorkspace: string | null;
  services: OnboardingServices;
  settings: AppSettings;
  stepId: OnboardingStepId;
  trustDraft: WorkspaceTrustContract | null;
}

function StepContent(props: StepContentProps) {
  switch (props.stepId) {
    case "welcome":
      return <WelcomeStep />;
    case "preferences":
      return (
        <PreferencesStep
          onAppearanceChange={props.onAppearanceChange}
          settings={props.settings}
        />
      );
    case "privacy":
      return (
        <PrivacyStep
          downloadModel={props.services.downloadPrivacyModel}
          getModelStatus={props.services.getPrivacyModelStatus}
          onModelDownloadProgress={
            props.services.onPrivacyModelDownloadProgress
          }
        />
      );
    case "api-key":
      return (
        <ApiKeyStep
          apiKey={props.apiKey}
          apiKeyConfigured={props.apiKeyConfigured}
          onApiKeyChange={props.onApiKeyChange}
        />
      );
    case "workspace":
      return <WorkspaceStep selectedWorkspace={props.selectedWorkspace} />;
    case "trust":
      return (
        <TrustBoundaryStep
          onTrustChange={props.onTrustChange}
          trustDraft={props.trustDraft}
        />
      );
    case "verification":
      return <VerificationStep />;
  }
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

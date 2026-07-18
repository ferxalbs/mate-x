import {
  ArrowUpIcon,
  PaperclipIcon,
  XIcon,
} from "@phosphor-icons/react";
import { LazyMotion, domMax, m, useReducedMotion } from "framer-motion";
import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";

import type { BehaviorPreference } from "../../../contracts/behavior-mode";
import type {
  AssistantAttachment,
  AssistantRunOptions,
} from "../../../contracts/chat";
import type { PolicyStop, PolicyStopAction } from "../../../contracts/policy";
import {
  getRainyServiceTierOptions,
  modelSupportsServiceTiers,
  type RainyModelCatalogEntry,
  type RainyModelLaunch,
  type RainyServiceTier,
} from "../../../contracts/rainy";
import type {
  WorkspaceSummary,
  WorkspaceTrustAutonomy,
  WorkspaceTrustContract,
} from "../../../contracts/workspace";
import { useTheme } from "../../../hooks/use-theme";
import {
  getReasoningEffortValues,
  supportsFileInput as modelSupportsFileInput,
  supportsImageInput as modelSupportsImageInput,
  supportsReasoning as modelSupportsReasoning,
  supportsVideoInput as modelSupportsVideoInput,
} from "../../../lib/rainy-model-capabilities";
import {
  findLaunchForModel,
  getAppControl,
  isAppControlAvailable,
} from "../../../lib/rainy-model-launches";
import { RESPONSIVE_SPRING } from "../../../lib/motion";
import { cn } from "../../../lib/utils";
import {
  getModel,
  listModelLaunches,
  listModels,
  setModel,
} from "../../../services/settings-client";
import { useChatStore } from "../../../store/chat-store";
import {
  ComposerAttachments,
  formatUnsupportedKinds,
  getUnsupportedAttachmentKinds,
  readAttachments,
} from "./composer-attachments";
import { ComposerCoreInput } from "./composer-core-input";
import { ComposerPermissionPrompt } from "./composer-permission-prompt";
import { ComposerRunSettings } from "./composer-run-settings";

interface ComposerPanelProps {
  canUndoLastTurn: boolean;
  isRunning: boolean;
  onResolvePolicyStop: (
    stop: PolicyStop,
    action: PolicyStopAction,
  ) => Promise<void>;
  workspace: WorkspaceSummary | null;
  onSubmit: (prompt: string, options: AssistantRunOptions) => Promise<void>;
  onUndoLastTurn: () => Promise<string | null>;
  pendingPolicyStop: PolicyStop | null;
  trustContract: WorkspaceTrustContract | null;
  prompt?: string;
  onPromptChange?: (prompt: string) => void;
  behavior: BehaviorPreference;
  onBehaviorChange: (value: BehaviorPreference) => void;
  onTrustChange: (value: WorkspaceTrustAutonomy) => Promise<void>;
}

export function ComposerPanel({
  isRunning,
  onResolvePolicyStop,
  workspace,
  onSubmit,
  pendingPolicyStop,
  trustContract,
  prompt: externalPrompt,
  onPromptChange,
  behavior,
  onBehaviorChange,
  onTrustChange,
}: ComposerPanelProps) {
  const reducedMotion = Boolean(useReducedMotion());
  const [prompt, setPrompt] = useState(externalPrompt ?? "");
  const [modelValue, setModelValue] = useState("");
  const [catalog, setCatalog] = useState<RainyModelCatalogEntry[]>([]);
  const [launches, setLaunches] = useState<RainyModelLaunch[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [isModelSaving, setIsModelSaving] = useState(false);
  const [reasoningEnabled, setReasoningEnabled] = useState(true);
  const [reasoningValue, setReasoningValue] =
    useState<AssistantRunOptions["reasoning"]>("high");
  const [serviceTier, setServiceTier] = useState<RainyServiceTier>("standard");
  const [capabilityNotice, setCapabilityNotice] = useState("");
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isResolvingPolicyStop, setIsResolvingPolicyStop] = useState(false);
  const [isCancellingRun, setIsCancellingRun] = useState(false);
  const [isTrustSaving, setIsTrustSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cancelActiveRun = useChatStore((state) => state.cancelActiveRun);
  const { blurEnabled } = useTheme();
  const hasWorkspace = Boolean(workspace);

  useEffect(() => {
    if (externalPrompt !== undefined && externalPrompt !== prompt) {
      setPrompt(externalPrompt);
    }
  }, [externalPrompt]);

  useEffect(() => {
    let cancelled = false;

    async function loadModelState() {
      setIsCatalogLoading(true);
      setCatalogError("");
      try {
        const [storedModel, nextCatalog, nextLaunches] = await Promise.all([
          getModel(),
          listModels(false),
          listModelLaunches(false).catch(() => [] as RainyModelLaunch[]),
        ]);
        if (cancelled) return;
        startTransition(() => {
          setCatalog(nextCatalog);
          setLaunches(nextLaunches);
          setModelValue(resolveModelValue(storedModel, nextCatalog));
        });
      } catch (error) {
        if (cancelled) return;
        setCatalog([]);
        setCatalogError(
          error instanceof Error ? error.message : "Could not load Rainy models.",
        );
      } finally {
        if (!cancelled) setIsCatalogLoading(false);
      }
    }

    void loadModelState();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedModel = useMemo(
    () => catalog.find((entry) => entry.id === modelValue) ?? null,
    [catalog, modelValue],
  );
  const activeLaunch = useMemo(
    () => findLaunchForModel(launches, modelValue),
    [launches, modelValue],
  );
  const reasoningControl = useMemo(
    () => getAppControl(activeLaunch, "reasoning"),
    [activeLaunch],
  );
  const serviceTierControl = useMemo(
    () => getAppControl(activeLaunch, "service_tier"),
    [activeLaunch],
  );
  const reasoningSupported =
    modelSupportsReasoning(selectedModel) &&
    (!reasoningControl || isAppControlAvailable(reasoningControl));
  const effortOptions = useMemo(
    () =>
      getReasoningEffortValues(selectedModel) as AssistantRunOptions["reasoning"][],
    [selectedModel],
  );
  const supportsReasoningEffort =
    reasoningSupported && effortOptions.length > 0;
  const serviceTierOptions = useMemo(
    () =>
      getRainyServiceTierOptions(
        selectedModel,
        serviceTierControl?.values ?? null,
      ),
    [selectedModel, serviceTierControl],
  );
  const showServiceTierSelector =
    (!serviceTierControl || isAppControlAvailable(serviceTierControl)) &&
    (modelSupportsServiceTiers(selectedModel, serviceTierControl?.values) ||
      (serviceTierControl?.values?.length ?? 0) > 0);
  const attachmentSupport = useMemo(
    () => ({
      file: modelSupportsFileInput(selectedModel),
      image: modelSupportsImageInput(selectedModel),
      video: modelSupportsVideoInput(selectedModel),
    }),
    [selectedModel],
  );
  const unsupportedAttachmentKinds = useMemo(
    () => getUnsupportedAttachmentKinds(attachments, attachmentSupport),
    [attachmentSupport, attachments],
  );
  const modelLabel =
    selectedModel?.label ??
    (isCatalogLoading ? "Loading…" : modelValue || "Unavailable");
  const trust = trustContract?.autonomy ?? "approval-required";

  useEffect(() => {
    if (!selectedModel) return;
    if (!serviceTierOptions.includes(serviceTier)) setServiceTier("standard");

    const attachmentNotice =
      unsupportedAttachmentKinds.length > 0
        ? `This model does not support ${formatUnsupportedKinds(unsupportedAttachmentKinds)}. Remove unsupported attachments or choose another model.`
        : "";

    if (!reasoningSupported && reasoningEnabled) setReasoningEnabled(false);
    if (
      reasoningSupported &&
      supportsReasoningEffort &&
      !effortOptions.includes(reasoningValue)
    ) {
      setReasoningValue(effortOptions[0]);
    }
    setCapabilityNotice(attachmentNotice);
  }, [
    effortOptions,
    reasoningEnabled,
    reasoningSupported,
    reasoningValue,
    selectedModel,
    serviceTier,
    serviceTierOptions,
    supportsReasoningEffort,
    unsupportedAttachmentKinds,
  ]);

  function handlePromptChange(value: string) {
    setPrompt(value);
    onPromptChange?.(value);
  }

  async function handleSubmit() {
    const nextPrompt = prompt.trim();
    if ((!nextPrompt && attachments.length === 0) || isRunning || isModelSaving) {
      return;
    }
    if (!hasWorkspace) {
      setCapabilityNotice("Open a repository before starting a review.");
      return;
    }
    if (unsupportedAttachmentKinds.length > 0) {
      setCapabilityNotice(
        `This model does not support ${formatUnsupportedKinds(unsupportedAttachmentKinds)}. Remove unsupported attachments or choose another model.`,
      );
      return;
    }

    if (modelValue) {
      setIsModelSaving(true);
      setCatalogError("");
      try {
        await setModel(modelValue);
      } catch (error) {
        setCatalogError(
          error instanceof Error
            ? error.message
            : "Could not activate Rainy model.",
        );
        setIsModelSaving(false);
        return;
      }
      setIsModelSaving(false);
    }

    const submittedAttachments = attachments;
    handlePromptChange("");
    setAttachments([]);
    await onSubmit(nextPrompt, {
      reasoningEnabled: reasoningSupported && reasoningEnabled,
      reasoning: reasoningValue,
      pathKind: "full",
      access: "approval",
      serviceTier,
      runbookId: "patch_test_verify",
      attachments: submittedAttachments,
    });
  }

  async function handleModelChange(nextModel: string) {
    if (!nextModel || nextModel === modelValue) return;
    setCatalogError("");
    setIsModelSaving(true);
    try {
      await setModel(nextModel);
      setModelValue(nextModel);
    } catch (error) {
      setCatalogError(
        error instanceof Error ? error.message : "Could not update Rainy model.",
      );
    } finally {
      setIsModelSaving(false);
    }
  }

  async function handleCancelRun() {
    if (!isRunning || isCancellingRun) return;
    setIsCancellingRun(true);
    try {
      await cancelActiveRun();
    } finally {
      setIsCancellingRun(false);
    }
  }

  async function handlePolicyAction(action: PolicyStopAction) {
    if (!pendingPolicyStop || isResolvingPolicyStop) return;
    setIsResolvingPolicyStop(true);
    try {
      await onResolvePolicyStop(pendingPolicyStop, action);
    } finally {
      setIsResolvingPolicyStop(false);
    }
  }

  async function handleTrustChange(autonomy: WorkspaceTrustAutonomy) {
    if (!trustContract || autonomy === trustContract.autonomy || isTrustSaving) {
      return;
    }
    setIsTrustSaving(true);
    setCapabilityNotice("");
    try {
      await onTrustChange(autonomy);
    } catch (error) {
      setCapabilityNotice(
        error instanceof Error
          ? error.message
          : "Could not update workspace trust.",
      );
    } finally {
      setIsTrustSaving(false);
    }
  }

  async function addFiles(fileList: FileList | File[]) {
    const nextAttachments = await readAttachments(fileList);
    setAttachments((current) => [...current, ...nextAttachments]);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingFile(false);
    void addFiles(event.dataTransfer.files);
  }

  const actionDisabled = isRunning
    ? isCancellingRun
    : (!prompt.trim() && attachments.length === 0) || isModelSaving;

  return (
    <LazyMotion features={domMax} strict>
      <div
        className={cn(
          "relative mx-auto flex w-full max-w-[820px] flex-col overflow-hidden rounded-[32px] border border-panel-border/40 shadow-none transition-[background-color,border-color,transform] duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] focus-within:border-foreground/20",
          blurEnabled
            ? "mate-glass-float focus-within:border-foreground/25"
            : "bg-mate-control-bg focus-within:bg-mate-control-bg",
          isDraggingFile && "ring-2 ring-foreground/20",
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          if (event.dataTransfer.types.includes("Files")) setIsDraggingFile(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setIsDraggingFile(false);
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        {pendingPolicyStop ? (
          <ComposerPermissionPrompt
            disabled={isResolvingPolicyStop}
            onAction={handlePolicyAction}
            stop={pendingPolicyStop}
          />
        ) : null}

        <ComposerCoreInput
          attachments={
            <ComposerAttachments
              attachments={attachments}
              onRemove={(id) =>
                setAttachments((current) =>
                  current.filter((attachment) => attachment.id !== id),
                )
              }
              support={attachmentSupport}
            />
          }
          onChange={handlePromptChange}
          onSubmit={() => void handleSubmit()}
          value={prompt}
          workspace={workspace}
        />

        {catalogError || capabilityNotice ? (
          <p
            className="relative z-10 break-words px-6 pb-1 text-[11px] text-amber-600 dark:text-amber-300"
            role="status"
          >
            {catalogError || capabilityNotice}
          </p>
        ) : null}

        <div className="relative z-10 flex min-w-0 items-center justify-between gap-2 px-4 pb-3 pt-2">
          <div className="flex min-w-0 items-center gap-2">
            <input
              className="hidden"
              multiple
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files);
                event.currentTarget.value = "";
              }}
              ref={fileInputRef}
              type="file"
            />
            <m.button
              aria-label="Attach files"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/5 text-foreground/60 transition-[background-color,color] duration-[180ms] ease-out hover:bg-foreground/15 hover:text-foreground disabled:opacity-40"
              disabled={!hasWorkspace}
              onClick={() => fileInputRef.current?.click()}
              transition={RESPONSIVE_SPRING}
              type="button"
              whileTap={
                !hasWorkspace || reducedMotion ? undefined : { scale: 0.96 }
              }
            >
              <PaperclipIcon className="size-4" />
            </m.button>
            <ComposerRunSettings
              behavior={behavior}
              catalog={catalog}
              effortOptions={effortOptions}
              isModelDisabled={
                isCatalogLoading || isModelSaving || catalog.length === 0
              }
              isTrustDisabled={!trustContract || isRunning || isTrustSaving}
              modelLabel={modelLabel}
              modelValue={modelValue}
              onBehaviorChange={onBehaviorChange}
              onModelChange={(value) => void handleModelChange(value)}
              onReasoningChange={setReasoningValue}
              onServiceTierChange={setServiceTier}
              onTrustChange={handleTrustChange}
              reasoningValue={reasoningValue}
              serviceTier={serviceTier}
              serviceTierOptions={serviceTierOptions}
              showServiceTierSelector={showServiceTierSelector}
              supportsReasoningEffort={supportsReasoningEffort}
              trust={trust}
            />
          </div>

          <m.button
            aria-label={isRunning ? "Stop" : "Run"}
            className={cn(
              "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-xs font-semibold shadow-none transition-[background-color,color,transform] duration-[180ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]",
              isRunning
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : actionDisabled
                  ? "cursor-not-allowed bg-foreground/5 text-foreground/30"
                  : "bg-foreground text-background hover:bg-foreground/90",
            )}
            disabled={actionDisabled}
            onClick={() =>
              void (isRunning ? handleCancelRun() : handleSubmit())
            }
            transition={RESPONSIVE_SPRING}
            type="button"
            whileTap={actionDisabled || reducedMotion ? undefined : { scale: 0.97 }}
          >
            {isRunning ? <XIcon className="size-3.5" /> : <ArrowUpIcon className="size-3.5" />}
            {isRunning ? "Stop" : "Run"}
          </m.button>
        </div>
      </div>
    </LazyMotion>
  );
}

function resolveModelValue(
  storedModel: string | null,
  catalog: RainyModelCatalogEntry[],
) {
  if (storedModel && catalog.some((entry) => entry.id === storedModel)) {
    return storedModel;
  }
  return catalog[0]?.id ?? storedModel ?? "";
}

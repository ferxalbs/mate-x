import {
  ArrowUpIcon,
  FileIcon,
  ImageIcon,
  ShieldCheckIcon,
  VideoIcon,
  XIcon,
  FolderIcon,
  MonitorIcon,
  GitBranchIcon,
} from "lucide-react";

import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";

import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "../../../components/ui/menu";
import { Slider } from "../../../components/ui/slider";
import {
  buildModelPowerOptions,
  getModelPowerLabel,
} from "./model-power-selector";

import type {
  AssistantAttachment,
  AssistantAttachmentKind,
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
  WorkspaceTrustContract,
} from "../../../contracts/workspace";
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
import { cn } from "../../../lib/utils";
import {
  getModel,
  listModelLaunches,
  listModels,
  setModel,
} from "../../../services/settings-client";
import { useChatStore } from "../../../store/chat-store";
import type { BehaviorPreference, BehaviorMode } from "../../../contracts/behavior-mode";

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
}: ComposerPanelProps) {
  const [prompt, setPrompt] = useState(externalPrompt ?? "");

  useEffect(() => {
    if (externalPrompt !== undefined && externalPrompt !== prompt) {
      setPrompt(externalPrompt);
    }
  }, [externalPrompt]);

  const handlePromptChange = (value: string) => {
    setPrompt(value);
    onPromptChange?.(value);
  };
  const [modelValue, setModelValue] = useState("");
  const [catalog, setCatalog] = useState<RainyModelCatalogEntry[]>([]);
  const [launches, setLaunches] = useState<RainyModelLaunch[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [isModelSaving, setIsModelSaving] = useState(false);
  const [reasoningEnabled, setReasoningEnabled] = useState(true);
  const [reasoningValue, setReasoningValue] =
    useState<AssistantRunOptions["reasoning"]>("high");
  const pathKind: NonNullable<AssistantRunOptions["pathKind"]> = "full";
  const [serviceTier, setServiceTier] = useState<RainyServiceTier>("standard");
  const [capabilityNotice, setCapabilityNotice] = useState("");
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isResolvingPolicyStop, setIsResolvingPolicyStop] = useState(false);
  const [isCancellingRun, setIsCancellingRun] = useState(false);
  const settings = useChatStore((state) => state.settings);
  const cancelActiveRun = useChatStore((state) => state.cancelActiveRun);
  const hasWorkspace = Boolean(workspace);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadModelState(forceRefresh = false) {
      setIsCatalogLoading(true);
      setCatalogError("");

      try {
        const [storedModel, nextCatalog, nextLaunches] = await Promise.all([
          getModel(),
          listModels(forceRefresh),
          // Launch feed is non-blocking; empty on failure keeps composer usable.
          listModelLaunches(forceRefresh).catch(() => [] as RainyModelLaunch[]),
        ]);
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setCatalog(nextCatalog);
          setLaunches(nextLaunches);
          setModelValue(resolveModelValue(storedModel, nextCatalog));
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setCatalog([]);
        setCatalogError(
          error instanceof Error
            ? error.message
            : "Could not load Rainy models.",
        );
      } finally {
        if (!cancelled) {
          setIsCatalogLoading(false);
        }
      }
    }

    void loadModelState(false);

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
  const modelLabel =
    selectedModel?.label ?? (modelValue || `Select model (${catalog.length})`);
  const supportsImageInput = modelSupportsImageInput(selectedModel);
  const supportsVideoInput = modelSupportsVideoInput(selectedModel);
  const supportsFileInput = modelSupportsFileInput(selectedModel);
  // Catalog capabilities remain source of truth for callable reasoning.
  // Launch app_controls only stage UI; staged never forces enablement.
  const reasoningSupported =
    modelSupportsReasoning(selectedModel) &&
    (!reasoningControl || isAppControlAvailable(reasoningControl));
  const serviceTierOptions = useMemo(
    () =>
      getRainyServiceTierOptions(
        selectedModel,
        serviceTierControl?.values ?? null,
      ),
    [selectedModel, serviceTierControl],
  );
  const serviceTierControlAvailable =
    !serviceTierControl || isAppControlAvailable(serviceTierControl);
  const showServiceTierSelector =
    serviceTierControlAvailable &&
    (modelSupportsServiceTiers(selectedModel, serviceTierControl?.values) ||
      (serviceTierControl?.values?.length ?? 0) > 0);
  const effortOptions = useMemo(
    () => getReasoningEffortValues(selectedModel),
    [selectedModel],
  );
  const supportsReasoningEffort =
    reasoningSupported && effortOptions.length > 0;
  const isModelDisabled =
    isCatalogLoading || isModelSaving || catalog.length === 0;
  const accessValue = "approval";
  const unsupportedAttachmentKinds = useMemo(
    () =>
      Array.from(
        new Set(
          attachments
            .filter(
              (attachment) =>
                !isAttachmentSupported(attachment.kind, {
                  image: supportsImageInput,
                  video: supportsVideoInput,
                  file: supportsFileInput,
                }),
            )
            .map((attachment) => attachment.kind),
        ),
      ),
    [attachments, supportsFileInput, supportsImageInput, supportsVideoInput],
  );

  useEffect(() => {
    if (!selectedModel) {
      return;
    }

    if (!serviceTierOptions.includes(serviceTier)) {
      setServiceTier("standard");
    }

    const attachmentNotice =
      unsupportedAttachmentKinds.length > 0
        ? `This model does not support ${formatUnsupportedKinds(unsupportedAttachmentKinds)}. Remove unsupported attachments or choose another model.`
        : "";

    if (!reasoningSupported && reasoningEnabled) {
      setReasoningEnabled(false);
      setCapabilityNotice(attachmentNotice);
      return;
    }

    if (
      reasoningSupported &&
      supportsReasoningEffort &&
      !effortOptions.includes(reasoningValue)
    ) {
      setReasoningValue(effortOptions[0]);
      setCapabilityNotice(attachmentNotice);
      return;
    }

    if (reasoningSupported && !supportsReasoningEffort && reasoningEnabled) {
      setCapabilityNotice(attachmentNotice);
      return;
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
    supportsFileInput,
    supportsImageInput,
    supportsReasoningEffort,
    supportsVideoInput,
    unsupportedAttachmentKinds,
  ]);

  async function handleSubmit() {
    const nextPrompt = prompt.trim();
    if (
      (!nextPrompt && attachments.length === 0) ||
      isRunning ||
      isModelSaving
    ) {
      return;
    }

    if (!hasWorkspace) {
      setCapabilityNotice("Import a folder before starting a review.");
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

    handlePromptChange("");
    setAttachments([]);
    await onSubmit(nextPrompt, {
      reasoningEnabled: reasoningSupported && reasoningEnabled,
      reasoning: reasoningValue,
      pathKind,
      access: accessValue as AssistantRunOptions["access"],
      serviceTier,
      runbookId: resolveRunbookForPathKind(pathKind),
      attachments,
    });
  }

  async function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) {
      return;
    }

    const nextAttachments = await Promise.all(files.map(readAttachment));
    setAttachments((current) => [...current, ...nextAttachments]);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingFile(false);
    void addFiles(event.dataTransfer.files);
  }

  async function handleModelChange(nextModel: string) {
    if (!nextModel || nextModel === modelValue) {
      return;
    }

    setCatalogError("");
    setIsModelSaving(true);

    try {
      await setModel(nextModel);
      setModelValue(nextModel);
      const nextEntry = catalog.find((entry) => entry.id === nextModel);
      const nextLaunch = findLaunchForModel(launches, nextModel);
      const nextTierControl = getAppControl(nextLaunch, "service_tier");
      if (
        !getRainyServiceTierOptions(
          nextEntry,
          nextTierControl?.values ?? null,
        ).includes(serviceTier)
      ) {
        setServiceTier("standard");
      }
    } catch (error) {
      setCatalogError(
        error instanceof Error
          ? error.message
          : "Could not update Rainy model.",
      );
    } finally {
      setIsModelSaving(false);
    }
  }

  async function handleCancelRun() {
    if (!isRunning || isCancellingRun) {
      return;
    }

    setIsCancellingRun(true);
    try {
      await cancelActiveRun();
    } finally {
      setIsCancellingRun(false);
    }
  }

  async function handlePolicyAction(action: PolicyStopAction) {
    if (!pendingPolicyStop || isResolvingPolicyStop) {
      return;
    }

    setIsResolvingPolicyStop(true);
    try {
      await onResolvePolicyStop(pendingPolicyStop, action);
    } finally {
      setIsResolvingPolicyStop(false);
    }
  }

  return (
    <>
      <div
        className={cn(
          "relative mx-auto flex w-full max-w-[820px] flex-col transition-all duration-[300ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] rounded-[32px] overflow-hidden",
          settings.blurEnabled
            ? "bg-[var(--panel)]/70 backdrop-blur-2xl border border-[var(--panel-border)]/40 shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
            : "bg-[var(--panel)] border border-[var(--panel-border)]/40 shadow-[0_8px_32px_rgba(0,0,0,0.08)]",
          isDraggingFile
            ? "ring-2 ring-foreground/20 bg-[var(--panel)]/90"
            : "",
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          if (event.dataTransfer.types.includes("Files")) {
            setIsDraggingFile(true);
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setIsDraggingFile(false);
          }
        }}
        onDrop={handleDrop}
      >
        {pendingPolicyStop ? (
          <div className="bg-background/40 backdrop-blur-md">
            <PermissionPrompt
              disabled={isResolvingPolicyStop}
              onAction={handlePolicyAction}
              stop={pendingPolicyStop}
            />
          </div>
        ) : null}

        {hasWorkspace && workspace ? (
          <div className="flex items-center gap-3 px-6 pt-4 pb-1 text-[11px] font-medium text-muted-foreground/50">
            <div className="flex items-center gap-1.5 transition-colors cursor-pointer hover:text-foreground">
              <FolderIcon className="size-3.5" />
              <span>{workspace.name}</span>
            </div>
            <div className="flex items-center gap-1.5 transition-colors cursor-pointer hover:text-foreground">
              <MonitorIcon className="size-3.5" />
              <span>Local</span>
            </div>
            <div className="flex items-center gap-1.5 transition-colors cursor-pointer hover:text-foreground">
              <GitBranchIcon className="size-3.5" />
              <span data-testid="composer-branch">
                {workspace.branch?.trim() || "detached"}
              </span>
            </div>
          </div>
        ) : null}

        <div className="relative z-10 bg-transparent px-6 py-2">
          <textarea
            className="min-h-[44px] w-full resize-none bg-transparent text-[15px] font-medium leading-relaxed text-foreground outline-none placeholder:text-foreground/30 focus:placeholder:text-foreground/50"
            onChange={(event) => handlePromptChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder={
              hasWorkspace
                ? "Describe an engineering objective…"
                : "Import a repository to start"
            }
            value={prompt}
          />
          {attachments.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {attachments.map((attachment) => (
                <AttachmentChip
                  attachment={attachment}
                  key={attachment.id}
                  unsupported={
                    !isAttachmentSupported(attachment.kind, {
                      image: supportsImageInput,
                      video: supportsVideoInput,
                      file: supportsFileInput,
                    })
                  }
                  onRemove={() =>
                    setAttachments((current) =>
                      current.filter((item) => item.id !== attachment.id),
                    )
                  }
                />
              ))}
            </div>
          ) : null}
        </div>

        {catalogError ? (
          <div className="relative z-10 px-6 pb-1 text-[11px] text-amber-300/90">
            {catalogError}
          </div>
        ) : null}
        {capabilityNotice ? (
          <div className="relative z-10 break-words px-6 pb-1 text-[11px] text-amber-600 dark:text-amber-300">
            {capabilityNotice}
          </div>
        ) : null}

        <div className="relative z-10 flex flex-col gap-3 px-4 pb-4 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <input
              className="hidden"
              multiple
              onChange={(event) => {
                if (event.target.files) {
                  void addFiles(event.target.files);
                }
                event.currentTarget.value = "";
              }}
              ref={fileInputRef}
              type="file"
            />
            <button
              aria-label="Attach files"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/5 text-foreground/60 transition-all hover:bg-foreground/15 hover:text-foreground hover:scale-105"
              disabled={!hasWorkspace}
              onClick={() => fileInputRef.current?.click()}
              title="Attach files"
              type="button"
            >
              <span className="text-xl font-light leading-none">+</span>
            </button>
            <div
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors"
              title="Access follows workspace trust and policy — not unrestricted"
            >
              <ShieldCheckIcon className="size-3.5" />
              <span>
                {trustContract?.autonomy === "unrestricted"
                  ? "Trust: unrestricted"
                  : trustContract?.autonomy === "trusted-patch"
                    ? "Trust: trusted patch"
                    : trustContract?.autonomy === "plan-only"
                      ? "Trust: plan only"
                      : "Trust: approval required"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <BehaviorSelector value={behavior} onChange={onBehaviorChange} />
            <ModelConfigurationMenu
              catalog={catalog}
              modelValue={modelValue}
              onModelChange={handleModelChange}
              modelLabel={isCatalogLoading ? "Loading..." : modelLabel}
              isModelDisabled={isModelDisabled}
              reasoningValue={reasoningValue}
              onReasoningChange={setReasoningValue}
              effortOptions={effortOptions}
              supportsReasoningEffort={supportsReasoningEffort}
              serviceTier={serviceTier}
              onServiceTierChange={setServiceTier}
              serviceTierOptions={serviceTierOptions}
              showServiceTierSelector={showServiceTierSelector}
            />

            <button
              type="button"
              aria-label="Voice input"
              title="Voice input"
              className="flex size-8 items-center justify-center rounded-full bg-transparent text-foreground/60 transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </button>
            <button
              aria-label="Send"
              className={cn(
                "flex size-8 items-center justify-center rounded-full transition-all duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] shadow-sm",
                isRunning
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : (!prompt.trim() && attachments.length === 0) ||
                      isModelSaving
                    ? "bg-foreground/5 text-foreground/30 shadow-none cursor-not-allowed"
                    : "bg-foreground text-background hover:scale-105 hover:bg-foreground/90 hover:shadow-md",
              )}
              disabled={
                (!prompt.trim() && attachments.length === 0 && !isRunning) ||
                isModelSaving
              }
              onClick={() => {
                if (isRunning) {
                  void handleCancelRun();
                } else {
                  void handleSubmit();
                }
              }}
              type="button"
            >
              {isRunning ? (
                <XIcon className="size-4" strokeWidth={2.5} />
              ) : (
                <ArrowUpIcon className="size-4" strokeWidth={2.5} />
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

const BEHAVIOR_MODE_LABELS: Record<BehaviorMode, string> = {
  auto: "Auto",
  guided: "Guided",
  review: "Review",
  custom: "Custom",
};

function BehaviorSelector({
  value,
  onChange,
}: {
  value: BehaviorPreference;
  onChange: (value: BehaviorPreference) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full border border-border/70 px-3 py-1.5 text-[11px] font-medium text-foreground transition-colors duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:bg-foreground/5"
        data-testid="behavior-selector"
      >
        {BEHAVIOR_MODE_LABELS[value.mode]}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-2xl border-border/70 bg-[var(--panel)]/92 shadow-none backdrop-blur-xl">
        <DropdownMenuRadioGroup
          value={value.mode}
          onValueChange={(mode) => onChange({ ...value, mode: mode as BehaviorMode })}
        >
          {(Object.keys(BEHAVIOR_MODE_LABELS) as BehaviorMode[]).map((mode) => (
            <DropdownMenuRadioItem key={mode} value={mode}>
              {BEHAVIOR_MODE_LABELS[mode]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {value.mode === "custom" ? (
          <div className="border-t border-border/70 p-2">
            {([
              ["askBeforeEdits", "Ask before edits"],
              ["askBeforeCommands", "Ask before commands"],
              ["askBeforeNetwork", "Ask before network"],
              ["askBeforeGit", "Ask before Git"],
              ["autoValidate", "Automatically validate"],
            ] as const).map(([key, label]) => (
              <label className="flex items-center justify-between gap-3 px-2 py-1.5 text-xs" key={key}>
                <span>{label}</span>
                <input
                  checked={value.custom[key]}
                  onChange={(event) => onChange({
                    ...value,
                    custom: { ...value.custom, [key]: event.target.checked },
                  })}
                  type="checkbox"
                />
              </label>
            ))}
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
  unsupported,
}: {
  attachment: AssistantAttachment;
  onRemove: () => void;
  unsupported: boolean;
}) {
  const Icon =
    attachment.kind === "image"
      ? ImageIcon
      : attachment.kind === "video"
        ? VideoIcon
        : FileIcon;

  return (
    <div
      className={cn(
        "flex h-7 max-w-[180px] items-center gap-1.5 rounded-xl border px-2.5 text-[11px] transition-all duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]",
        unsupported
          ? "border-amber-400/40 bg-amber-400/5 text-amber-600 dark:text-amber-300"
          : "border-border/40 bg-[var(--mate-control-bg)]/50 text-muted-foreground hover:border-border/60",
      )}
      title={`${attachment.name} (${formatBytes(attachment.size)})`}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{attachment.name}</span>
      <button
        aria-label={`Remove ${attachment.name}`}
        className="ml-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
        onClick={onRemove}
        type="button"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}

async function readAttachment(file: File): Promise<AssistantAttachment> {
  const kind = getAttachmentKind(file);
  const base = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    kind,
  };

  if (kind === "image" || kind === "video") {
    return { ...base, dataUrl: await readFileAsDataUrl(file) };
  }

  if (isTextLikeFile(file)) {
    return { ...base, text: await file.text() };
  }

  return { ...base, dataUrl: await readFileAsDataUrl(file) };
}

function getAttachmentKind(file: File): AssistantAttachmentKind {
  if (file.type.startsWith("image/")) {
    return "image";
  }

  if (file.type.startsWith("video/")) {
    return "video";
  }

  return "file";
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

function isTextLikeFile(file: File) {
  return (
    file.type.startsWith("text/") ||
    /\.(csv|json|md|txt|xml|yaml|yml)$/i.test(file.name)
  );
}

function isAttachmentSupported(
  kind: AssistantAttachmentKind,
  support: { image: boolean; video: boolean; file: boolean },
) {
  return support[kind];
}

function formatUnsupportedKinds(kinds: AssistantAttachmentKind[]) {
  return kinds
    .map((kind) =>
      kind === "image" ? "images" : kind === "video" ? "video" : "files",
    )
    .join(", ");
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PermissionPrompt({
  disabled,
  onAction,
  stop,
}: {
  disabled: boolean;
  onAction: (action: PolicyStopAction) => void;
  stop: PolicyStop;
}) {
  const toolName = stop.attemptedAction.toolName ?? "tool action";
  const target =
    stop.attemptedAction.command ??
    stop.attemptedAction.target ??
    stop.policyId;
  const canApprove = stop.availableActions.includes("approve_once");
  const canDecline =
    stop.availableActions.includes("safer_alternative") ||
    stop.availableActions.includes("abort");

  return (
    <div className="border-b border-border/20 px-5 py-3.5 transition-all duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-2 py-0.5 font-medium text-amber-500 dark:text-amber-400">
              Approval required
            </span>
            <span className="text-muted-foreground/80">{toolName}</span>
            <span className="truncate rounded-md bg-[var(--mate-control-bg)]/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {target}
            </span>
          </div>
          <div className="mt-2 text-[13px] font-medium text-foreground/90">{stop.title}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canDecline ? (
            <Button
              className="h-8 rounded-full border-border/40 bg-transparent px-3.5 text-[11px] text-muted-foreground shadow-none hover:bg-accent"
              disabled={disabled}
              onClick={() =>
                onAction(
                  stop.availableActions.includes("safer_alternative")
                    ? "safer_alternative"
                    : "abort",
                )
              }
              size="xs"
              variant="outline"
            >
              Review command
            </Button>
          ) : null}
          {canApprove ? (
            <Button
              className="h-8 rounded-full bg-emerald-500/10 text-[11px] text-emerald-600 shadow-none hover:bg-emerald-500/20 dark:text-emerald-400"
              disabled={disabled}
              onClick={() => onAction("approve_once")}
              size="xs"
              variant="ghost"
            >
              Approve once
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ModelConfigurationMenu({
  catalog,
  modelValue,
  onModelChange,
  modelLabel,
  isModelDisabled,
  reasoningValue,
  onReasoningChange,
  effortOptions,
  supportsReasoningEffort,
  serviceTier,
  onServiceTierChange,
  serviceTierOptions,
  showServiceTierSelector,
}: {
  catalog: RainyModelCatalogEntry[];
  modelValue: string;
  onModelChange: (val: string) => void;
  modelLabel: string;
  isModelDisabled: boolean;
  reasoningValue: string;
  onReasoningChange: (val: any) => void;
  effortOptions: string[];
  supportsReasoningEffort: boolean;
  serviceTier: RainyServiceTier;
  onServiceTierChange: (val: RainyServiceTier) => void;
  serviceTierOptions: RainyServiceTier[];
  showServiceTierSelector: boolean;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const powerOptions = buildModelPowerOptions(catalog);
  const currentIndex = powerOptions.findIndex(
    ({ model }) => model.id === modelValue,
  );
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const selectedPowerOption = powerOptions[safeIndex];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isModelDisabled}
        className="flex h-8 items-center gap-1.5 rounded-[12px] bg-foreground/[0.03] px-3 text-[12px] font-medium text-foreground/80 transition-all duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <span>{modelLabel}</span>
        {supportsReasoningEffort && (
          <span className="text-foreground/50">
            {formatReasoningEffort(reasoningValue as any)}
          </span>
        )}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="ml-0.5 opacity-60"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-56 overflow-hidden rounded-[20px] border-[var(--panel-border)]/40 bg-[var(--panel)]/95 p-1.5 shadow-none backdrop-blur-xl"
      >
        {!advancedOpen && (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="h-8 rounded-[12px] px-3 text-[13px] focus:bg-foreground/[0.05]">
                <span className="flex-1">Model</span>
                <span className="text-muted-foreground">{modelLabel}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                sideOffset={4}
                className="w-56 overflow-hidden rounded-[20px] bg-[var(--panel)]/95 p-1.5 shadow-lg backdrop-blur-3xl"
              >
                <DropdownMenuRadioGroup
                  value={modelValue}
                  onValueChange={onModelChange}
                >
                  {catalog.map((entry) => (
                    <DropdownMenuRadioItem
                      key={entry.id}
                      value={entry.id}
                      className="h-8 rounded-[12px] px-3 text-[13px] focus:bg-foreground/[0.05]"
                    >
                      {entry.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {supportsReasoningEffort && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="h-8 rounded-[12px] px-3 text-[13px] focus:bg-foreground/[0.05]">
                  <span className="flex-1">Effort</span>
                  <span className="text-muted-foreground">
                    {formatReasoningEffort(reasoningValue as any)}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  sideOffset={4}
                  className="w-48 overflow-hidden rounded-[20px] bg-[var(--panel)]/95 p-1.5 shadow-lg backdrop-blur-3xl"
                >
                  <DropdownMenuRadioGroup
                    value={reasoningValue}
                    onValueChange={onReasoningChange}
                  >
                    {effortOptions.map((opt) => (
                      <DropdownMenuRadioItem
                        key={opt}
                        value={opt}
                        className="h-8 rounded-[12px] px-3 text-[13px] focus:bg-foreground/[0.05]"
                      >
                        {formatReasoningEffort(opt as any)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}

            {showServiceTierSelector && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="h-8 rounded-[12px] px-3 text-[13px] focus:bg-foreground/[0.05]">
                  <span className="flex-1">Speed</span>
                  <span className="text-muted-foreground">
                    {formatServiceTier(serviceTier)}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  sideOffset={4}
                  className="w-48 overflow-hidden rounded-[20px] bg-[var(--panel)]/95 p-1.5 shadow-lg backdrop-blur-3xl"
                >
                  <DropdownMenuRadioGroup
                    value={serviceTier}
                    onValueChange={(val) =>
                      onServiceTierChange(val as RainyServiceTier)
                    }
                  >
                    {serviceTierOptions.map((tier) => (
                      <DropdownMenuRadioItem
                        key={tier}
                        value={tier}
                        className="h-8 rounded-[12px] px-3 text-[13px] focus:bg-foreground/[0.05]"
                      >
                        {formatServiceTier(tier)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}

            <div className="my-1.5 border-b border-foreground/[0.05]" />
          </>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setAdvancedOpen((open) => !open);
          }}
          className="flex h-8 w-full items-center justify-between rounded-[12px] px-3 text-[13px] transition-colors focus:bg-foreground/[0.05] hover:bg-foreground/[0.05]"
        >
          <span>Advanced</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn(
              "opacity-60 transition-transform duration-[150ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]",
              advancedOpen && "rotate-180",
            )}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {advancedOpen && (
          <div className="flex flex-col gap-2.5 px-3 pb-3 pt-2 animate-in fade-in duration-150">
            <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground/80">
              <span>Faster</span>
              <span>Smartest</span>
            </div>

            <div className="px-1 py-2">
              <Slider
                min={0}
                max={Math.max(0, powerOptions.length - 1)}
                step={1}
                value={[safeIndex]}
                disabled={powerOptions.length < 2}
                thumbLabel="Model power"
                onValueChange={(value) => {
                  const index = Array.isArray(value) ? value[0] : value;
                  const option = powerOptions[index];
                  if (option) {
                    onModelChange(option.model.id);
                  }
                }}
                className="w-full"
              />
            </div>

            <div className="text-center">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {getModelPowerLabel(safeIndex, powerOptions.length)}
              </div>
              <div className="mt-1 break-words text-[12px] font-medium text-foreground">
                {selectedPowerOption?.model.label ??
                  "No GPT-5.6 or Claude models available"}
              </div>
            </div>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatReasoningEffort(effort: AssistantRunOptions["reasoning"]) {
  if (effort === "xhigh") {
    return "X High";
  }

  return effort
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveRunbookForPathKind(pathKind: NonNullable<AssistantRunOptions["pathKind"]>) {
  if (pathKind === "chat_help") {
    return "review_classify_summarize";
  }

  return "patch_test_verify";
}

function formatServiceTier(tier: RainyServiceTier) {
  switch (tier) {
    case "flex":
      return "Flex";
    case "priority":
      return "Priority";
    case "scale":
      return "Scale";
    default:
      return "Standard";
  }
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

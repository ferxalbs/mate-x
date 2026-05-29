import {
  ArrowUpIcon,
  BrainIcon,
  FileIcon,
  ImageIcon,
  LoaderCircle,
  PaperclipIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  VideoIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import {
  Frame,
  Glass,
  GlassContainer,
  Html,
  LiquidCanvas,
  ZStack,
} from "@liquid-dom/react";
import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

import { Button } from "../../../components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
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
  type RainyServiceTier,
} from "../../../contracts/rainy";
import type { RepoGraphEmbeddingProgress } from "../../../contracts/repo-graph";
import type {
  WorkspaceSummary,
  WorkspaceTrustContract,
} from "../../../contracts/workspace";
import {
  getReasoningEffortValues,
  supportsFileInput as modelSupportsFileInput,
  supportsImageInput as modelSupportsImageInput,
  supportsReasoning as modelSupportsReasoning,
  supportsTools,
  supportsVideoInput as modelSupportsVideoInput,
} from "../../../lib/rainy-model-capabilities";
import { cn } from "../../../lib/utils";
import {
  getEmbeddingModel,
  getModel,
  listEmbeddingModels,
  listModels,
  setEmbeddingModel,
  setModel,
} from "../../../services/settings-client";

interface ComposerPanelProps {
  canUndoLastTurn: boolean;
  isRunning: boolean;
  liquidGlassEnabled?: boolean;
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
}

export function ComposerPanel({
  canUndoLastTurn,
  isRunning,
  liquidGlassEnabled = false,
  onResolvePolicyStop,
  workspace,
  onSubmit,
  onUndoLastTurn,
  pendingPolicyStop,
  trustContract,
  prompt: externalPrompt,
  onPromptChange,
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
  const [embeddingModelValue, setEmbeddingModelValue] = useState("");
  const [embeddingCatalog, setEmbeddingCatalog] = useState<
    Array<{
      id: string;
      label: string;
      dimensions: number;
      contextLength: number;
    }>
  >([]);
  const [embeddingProgress, setEmbeddingProgress] =
    useState<RepoGraphEmbeddingProgress | null>(null);
  const [catalog, setCatalog] = useState<RainyModelCatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [isModelSaving, setIsModelSaving] = useState(false);
  const [reasoningEnabled, setReasoningEnabled] = useState(true);
  const [reasoningValue, setReasoningValue] =
    useState<AssistantRunOptions["reasoning"]>("high");
  const [modeValue, setModeValue] =
    useState<AssistantRunOptions["mode"]>("build");
  const [serviceTier, setServiceTier] = useState<RainyServiceTier>("standard");
  const [capabilityNotice, setCapabilityNotice] = useState("");
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isResolvingPolicyStop, setIsResolvingPolicyStop] = useState(false);
  const hasWorkspace = Boolean(workspace);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadModelState(forceRefresh = false) {
      setIsCatalogLoading(true);
      setCatalogError("");

      try {
        const [storedModel, nextCatalog] = await Promise.all([
          getModel(),
          listModels(forceRefresh),
        ]);
        const [storedEmbeddingModel, nextEmbeddingCatalog] = await Promise.all([
          getEmbeddingModel(),
          listEmbeddingModels(),
        ]);

        if (cancelled) {
          return;
        }

        startTransition(() => {
          setCatalog(nextCatalog);
          setModelValue(resolveModelValue(storedModel, nextCatalog));
          setEmbeddingCatalog(nextEmbeddingCatalog);
          setEmbeddingModelValue(
            resolveEmbeddingModelValue(
              storedEmbeddingModel,
              nextEmbeddingCatalog,
            ),
          );
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

  useEffect(
    () =>
      window.mate.repo.graph.onEmbeddingProgress(
        (progress: RepoGraphEmbeddingProgress) => {
          setEmbeddingProgress(progress);
        },
      ),
    [],
  );

  const selectedModel = useMemo(
    () => catalog.find((entry) => entry.id === modelValue) ?? null,
    [catalog, modelValue],
  );
  const modelLabel =
    selectedModel?.label ?? (modelValue || `Select model (${catalog.length})`);
  const selectedEmbeddingModel =
    embeddingCatalog.find((entry) => entry.id === embeddingModelValue) ?? null;
  const embeddingModelLabel =
    selectedEmbeddingModel?.label ??
    embeddingModelValue ??
    "Select embedding model";
  const supportsImageInput = modelSupportsImageInput(selectedModel);
  const supportsVideoInput = modelSupportsVideoInput(selectedModel);
  const supportsFileInput = modelSupportsFileInput(selectedModel);
  const reasoningSupported = modelSupportsReasoning(selectedModel);
  const toolCallingSupported = supportsTools(selectedModel);
  const serviceTierOptions = useMemo(
    () => getRainyServiceTierOptions(selectedModel),
    [selectedModel],
  );
  const showServiceTierSelector = modelSupportsServiceTiers(selectedModel);
  const effortOptions = useMemo(
    () => getReasoningEffortValues(selectedModel),
    [selectedModel],
  );
  const supportsReasoningEffort =
    reasoningSupported && effortOptions.length > 0;
  const reasoningToggleLabel = reasoningEnabled
    ? supportsReasoningEffort
      ? "Reasoning"
      : "Reasoning on"
    : "Reasoning off";
  const isModelDisabled =
    isCatalogLoading || isModelSaving || catalog.length === 0;
  const accessValue =
    trustContract?.autonomy === "trusted-patch" ? "full" : "approval";
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
      mode: modeValue,
      access: accessValue as AssistantRunOptions["access"],
      serviceTier,
      runbookId: "patch_test_verify",
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
      if (!getRainyServiceTierOptions(nextEntry).includes(serviceTier)) {
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

  async function handleEmbeddingModelChange(nextModel: string) {
    if (!nextModel || nextModel === embeddingModelValue) {
      return;
    }

    setCatalogError("");
    setIsModelSaving(true);

    try {
      setEmbeddingProgress(null);
      await setEmbeddingModel(nextModel);
      setEmbeddingModelValue(nextModel);
    } catch (error) {
      setCatalogError(
        error instanceof Error
          ? error.message
          : "Could not update Rainy embedding model.",
      );
    } finally {
      setIsModelSaving(false);
    }
  }

  async function handleUndoLastTurn() {
    const restoredPrompt = await onUndoLastTurn();
    if (restoredPrompt) {
      handlePromptChange(restoredPrompt);
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
            "relative overflow-hidden rounded-[32px] transition-all duration-300",
            liquidGlassEnabled
              ? "border border-white/15 bg-transparent shadow-[var(--mate-floating-shadow),inset_0_1px_0_rgba(255,255,255,0.22)]"
              : "glass border border-[var(--panel-border)]/70 bg-[var(--mate-panel-bg)]",
            isDraggingFile ? "ring-2 ring-primary/70" : "",
          )}
          style={
            liquidGlassEnabled
              ? undefined
              : ({ "--glass-bg": "var(--panel)" } as React.CSSProperties)
          }
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
          {liquidGlassEnabled ? <ComposerLiquidGlass /> : null}
          {pendingPolicyStop ? (
            <PermissionPrompt
              disabled={isResolvingPolicyStop}
              onAction={handlePolicyAction}
              stop={pendingPolicyStop}
            />
          ) : null}
          {capabilityNotice ? (
            <div className="relative z-10 border-b border-border/35 px-5 py-2 text-[11px] leading-5 text-amber-600 dark:text-amber-300/90">
              {capabilityNotice}
            </div>
          ) : null}
          <div className="relative z-10 bg-transparent px-5 py-4">
            <textarea
              className="min-h-[76px] w-full resize-none bg-transparent text-[14px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/65 sm:min-h-[60px]"
              onChange={(event) => handlePromptChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder={
                hasWorkspace
                  ? "Ask anything, @tag files/folders, or use / to show available commands"
                  : "Import a folder to start a repository review"
              }
              value={prompt}
            />
            {attachments.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
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
            <div className="relative z-10 px-5 pb-1 text-[11px] text-amber-300/90">
              {catalogError}
            </div>
          ) : null}

          <div className="relative z-10 flex flex-col gap-3 px-3 pb-3 pt-0.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto pb-1 turn-chip-strip sm:pb-0">
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
                className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent sm:size-6"
                disabled={!hasWorkspace}
                onClick={() => fileInputRef.current?.click()}
                title="Attach files"
                type="button"
              >
                <PaperclipIcon className="size-3.5" />
              </button>
              <InlineSelect
                value={modelValue}
                onValueChange={handleModelChange}
                disabled={isModelDisabled}
                label={isCatalogLoading ? "Loading models" : modelLabel}
              >
                {catalog.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{entry.label}</span>
                      <span className="truncate text-[10px] text-muted-foreground/75">
                        {entry.id}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </InlineSelect>
              <InlineSelect
                value={embeddingModelValue}
                onValueChange={handleEmbeddingModelChange}
                disabled={
                  isCatalogLoading ||
                  isModelSaving ||
                  embeddingCatalog.length === 0
                }
                label={embeddingModelLabel}
              >
                {embeddingCatalog.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{entry.label}</span>
                      <span className="truncate text-[10px] text-muted-foreground/75">
                        {entry.dimensions}d ·{" "}
                        {Math.round(entry.contextLength / 1024)}k ctx
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </InlineSelect>
              {embeddingProgress ? (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
                    embeddingProgress.state === "failed"
                      ? "bg-destructive/15 text-destructive-foreground"
                      : embeddingProgress.state === "ready"
                        ? "bg-emerald-500/12 text-emerald-500"
                        : "bg-primary/12 text-primary",
                  )}
                  title={`${embeddingProgress.indexed}/${embeddingProgress.total} repo graph embeddings`}
                >
                  {embeddingProgress.state === "ready"
                    ? "Indexed"
                    : `Index ${embeddingProgress.percent}%`}
                </span>
              ) : null}
              {reasoningSupported ? (
                <button
                  type="button"
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent sm:size-6",
                    reasoningEnabled
                      ? "text-foreground"
                      : "text-muted-foreground/60",
                  )}
                  onClick={() => setReasoningEnabled((value) => !value)}
                  title={reasoningToggleLabel}
                >
                  <BrainIcon className="size-3.5" />
                </button>
              ) : null}
              <div
                className={cn(
                  "grid shrink-0 transition-all duration-300 ease-out",
                  reasoningEnabled && supportsReasoningEffort
                    ? "grid-cols-[1fr] opacity-100"
                    : "grid-cols-[0fr] opacity-0",
                )}
              >
                <div className="min-w-0 overflow-hidden">
                  <InlineSelect
                    value={reasoningValue}
                    onValueChange={(value) =>
                      setReasoningValue(
                        value as AssistantRunOptions["reasoning"],
                      )
                    }
                    label={formatReasoningEffort(reasoningValue)}
                    title={`Reasoning effort: ${formatReasoningEffort(reasoningValue)}`}
                  >
                    {effortOptions.map((effort) => (
                      <SelectItem key={effort} value={effort}>
                        {formatReasoningEffort(effort)}
                      </SelectItem>
                    ))}
                  </InlineSelect>
                </div>
              </div>
              <InlineSelect
                value={modeValue}
                onValueChange={(value) =>
                  setModeValue(value as AssistantRunOptions["mode"])
                }
                label={formatAssistantMode(modeValue)}
                title={`Execution mode: ${formatAssistantMode(modeValue)}`}
              >
                <SelectItem value="build">Build</SelectItem>
                <SelectItem value="plan">Plan</SelectItem>
                <SelectItem value="critic_loop">Critic Loop</SelectItem>
              </InlineSelect>
              {showServiceTierSelector ? (
                <InlineSelect
                  value={serviceTier}
                  onValueChange={(value) => setServiceTier(value as RainyServiceTier)}
                  label={formatServiceTier(serviceTier)}
                  title={`Service tier: ${formatServiceTier(serviceTier)}`}
                >
                  {serviceTierOptions.map((tier) => (
                    <SelectItem key={tier} value={tier}>
                      <div className="flex min-w-0 flex-col">
                        <span>{formatServiceTier(tier)}</span>
                        <span className="truncate text-[10px] text-muted-foreground/75">
                          {formatServiceTierDescription(tier, selectedModel)}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </InlineSelect>
              ) : null}
              {!supportsImageInput ? (
                <button
                  aria-label="Images unavailable"
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground/35 sm:size-6"
                  disabled
                  title="This model does not process images."
                  type="button"
                >
                  <ImageIcon className="size-3.5" />
                </button>
              ) : null}
              {!supportsVideoInput ? (
                <button
                  aria-label="Video unavailable"
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground/35 sm:size-6"
                  disabled
                  title="This model does not process video."
                  type="button"
                >
                  <VideoIcon className="size-3.5" />
                </button>
              ) : null}
              {!supportsFileInput ? (
                <button
                  aria-label="Files unavailable"
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground/35 sm:size-6"
                  disabled
                  title="This model does not process files."
                  type="button"
                >
                  <FileIcon className="size-3.5" />
                </button>
              ) : null}
              {toolCallingSupported ? (
                <div
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground sm:size-6"
                  title="Supports tools"
                >
                  <WrenchIcon className="size-3.5" />
                </div>
              ) : null}
              <div
                className="flex size-7 shrink-0 items-center justify-center rounded-lg text-success sm:size-6"
                title={
                  trustContract
                    ? `Contract v${trustContract.version}: ${trustContract.autonomy}`
                    : "Contract pending"
                }
              >
                <ShieldCheckIcon className="size-3.5" />
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-3 text-[11px] text-muted-foreground/60">
              {canUndoLastTurn ? (
                <Button
                  aria-label="Undo last turn"
                  className="h-8 rounded-full border-border/60 bg-transparent px-3 text-[11px] text-muted-foreground shadow-none hover:bg-accent"
                  disabled={isRunning || isModelSaving}
                  onClick={() => void handleUndoLastTurn()}
                  size="xs"
                  variant="outline"
                >
                  <RotateCcwIcon className="size-3.5" />
                  Undo
                </Button>
              ) : null}
              <Button
                aria-label={isRunning ? "Thinking" : "Send"}
                className={cn(
                  "size-9 rounded-lg border-0 bg-primary p-0 text-primary-foreground shadow-none hover:bg-primary/90",
                  isRunning ? "opacity-90" : "",
                )}
                disabled={isRunning || isModelSaving || !hasWorkspace}
                onClick={handleSubmit}
                size="icon-sm"
                variant="outline"
              >
                {isRunning ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ArrowUpIcon className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
    </>
  );
}

function ComposerLiquidGlass() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0">
      {/*
        Only the LiquidCanvas remains. The ZStack backdrop at zIndex=-2
        provides the gradient source for GlassContainer to blur. No extra
        CSS layers on top — anything painted here covers the canvas output
        and kills the glass effect.
      */}
      <LiquidCanvas
        className="absolute inset-0"
        canvasClassName="absolute inset-0 h-full w-full rounded-[32px] bg-transparent"
      >
        <ZStack alignment="center">
          {/* Backdrop: same gradient as the global UniversalBackground */}
          <Html zIndex={-2} sizing="fill">
            <div className="h-full w-full bg-[image:var(--mate-shell-base)]" />
          </Html>
          <Frame maxWidth={Infinity} maxHeight={Infinity}>
            <GlassContainer
              blur={500}
              bezelWidth={100}
              displacementBlur={18}
              thickness={0}
              shadowColor={{ r: 0, g: 0, b: 0, a: 0.10 }}
              shadowBlur={20}
              specularOpacity={0.75}
              surfaceProfile="concave"
              specularFalloff={1.2}
              tint={{ r: 1, g: 1, b: 1, a: 0.0 }}
            >
              <Glass cornerRadius={32}>
                <Frame maxWidth={Infinity} maxHeight={Infinity}>
                  <Html sizing="fill">
                    <div className="h-full w-full bg-transparent" />
                  </Html>
                </Frame>
              </Glass>
            </GlassContainer>
          </Frame>
        </ZStack>
      </LiquidCanvas>
    </div>
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
        "flex h-7 max-w-[180px] items-center gap-1.5 rounded-md border px-2 text-[11px]",
        unsupported
          ? "border-amber-400/50 bg-amber-400/10 text-amber-600 dark:text-amber-300"
          : "border-border/55 bg-[var(--mate-control-bg)] text-muted-foreground",
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
    <div className="border-b border-border/50 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-md border border-amber-300/30 bg-amber-400/8 px-2 py-1 font-medium text-amber-200">
              Approval required
            </span>
            <span className="text-muted-foreground">{toolName}</span>
            <span className="truncate rounded-md border border-border/55 bg-[var(--mate-control-bg)] px-2 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur-md">
              {target}
            </span>
          </div>
          <div className="mt-2 text-[12px] font-medium text-foreground/90">
            {stop.title}
          </div>
          <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
            {stop.explanation}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canDecline ? (
            <Button
              className="h-8 rounded-full border-border/60 bg-transparent px-3 text-[11px] text-muted-foreground shadow-none hover:bg-accent"
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
              Continue without it
            </Button>
          ) : null}
          {canApprove ? (
            <Button
              className="h-8 rounded-full bg-emerald-500 px-3 text-[11px] text-white shadow-none hover:bg-emerald-400"
              disabled={disabled}
              onClick={() => onAction("approve_once")}
              size="xs"
              variant="outline"
            >
              Approve once
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InlineSelect({
  value,
  onValueChange,
  disabled = false,
  label,
  title,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Select
      disabled={disabled}
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue) {
          onValueChange(nextValue);
        }
      }}
    >
      <SelectTrigger
        size="xs"
        variant="ghost"
        className="h-6 min-w-fit shrink-0 rounded-md border-0 px-2 text-[11px] text-muted-foreground shadow-none hover:bg-accent"
        title={title}
      >
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectPopup className="max-w-[min(22rem,var(--available-width))] text-popover-foreground">
        {children}
      </SelectPopup>
    </Select>
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

function formatAssistantMode(mode: AssistantRunOptions["mode"]) {
  switch (mode) {
    case "critic_loop":
      return "Critic Loop";
    case "plan":
      return "Plan";
    default:
      return "Build";
  }
}

function formatServiceTier(tier: RainyServiceTier) {
  switch (tier) {
    case "flex":
      return "Flex";
    case "priority":
      return "Priority";
    default:
      return "Standard";
  }
}

function formatServiceTierDescription(
  tier: RainyServiceTier,
  model: RainyModelCatalogEntry | null,
) {
  const tierPricing = model?.pricing?.service_tiers?.find(
    (item) => item.tier === tier,
  );
  const inputPrice = tierPricing?.input ?? tierPricing?.prompt;
  const outputPrice = tierPricing?.output ?? tierPricing?.completion;
  const priceSummary =
    inputPrice !== undefined || outputPrice !== undefined
      ? [inputPrice === undefined ? null : `in ${inputPrice}`, outputPrice === undefined ? null : `out ${outputPrice}`]
          .filter(Boolean)
          .join(" · ")
      : "";

  const description =
    tier === "flex"
      ? "Cheaper, may be slower/queued"
      : tier === "priority"
        ? "Higher cost, faster capacity"
        : "Default";

  return priceSummary ? `${description} · ${priceSummary}` : description;
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

function resolveEmbeddingModelValue(
  storedModel: string | null,
  catalog: Array<{ id: string }>,
) {
  if (storedModel && catalog.some((entry) => entry.id === storedModel)) {
    return storedModel;
  }

  return catalog[0]?.id ?? storedModel ?? "";
}

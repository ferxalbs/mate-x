import { FileIcon, ImageIcon, VideoIcon, XIcon } from "lucide-react";

import type {
  AssistantAttachment,
  AssistantAttachmentKind,
} from "../../../contracts/chat";
import { cn } from "../../../lib/utils";

export interface AttachmentSupport {
  file: boolean;
  image: boolean;
  video: boolean;
}

export function ComposerAttachments({
  attachments,
  onRemove,
  support,
}: {
  attachments: AssistantAttachment[];
  onRemove: (id: string) => void;
  support: AttachmentSupport;
}) {
  if (attachments.length === 0) return null;

  return (
    <div aria-label="Attachments" className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => (
        <AttachmentChip
          attachment={attachment}
          key={attachment.id}
          onRemove={() => onRemove(attachment.id)}
          unsupported={!support[attachment.kind]}
        />
      ))}
    </div>
  );
}

export function getUnsupportedAttachmentKinds(
  attachments: AssistantAttachment[],
  support: AttachmentSupport,
) {
  const unsupportedKinds = new Set<AssistantAttachmentKind>();

  for (const attachment of attachments) {
    if (!support[attachment.kind]) {
      unsupportedKinds.add(attachment.kind);
    }
  }

  return Array.from(unsupportedKinds);
}

export function formatUnsupportedKinds(kinds: AssistantAttachmentKind[]) {
  return kinds
    .map((kind) =>
      kind === "image" ? "images" : kind === "video" ? "video" : "files",
    )
    .join(", ");
}

export async function readAttachments(fileList: FileList | File[]) {
  return Promise.all(Array.from(fileList).map(readAttachment));
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
        "flex h-7 max-w-[180px] items-center gap-1.5 rounded-xl border px-2.5 text-[11px] transition-[background-color,border-color,color] duration-[var(--motion-press)] ease-[var(--ease-out)]",
        unsupported
          ? "border-amber-400/40 bg-amber-400/5 text-amber-600 dark:text-amber-300"
          : "border-border/40 bg-mate-control-bg/50 text-muted-foreground hover:border-border/60",
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
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

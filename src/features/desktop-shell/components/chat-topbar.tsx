import {
  ActivityIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  FileSearchIcon,
  GitBranchIcon,
  Loader2Icon,
  MapIcon,
  PanelRightIcon,
  PlusIcon,
  TargetIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "../../../components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "../../../components/ui/menu";
import { SidebarTrigger, useSidebar } from "../../../components/ui/sidebar";
import type { Conversation, RunStatus } from "../../../contracts/chat";
import type { WorkspaceSummary } from "../../../contracts/workspace";
import type { Appearance } from "../../../hooks/use-theme";
import { usePlatform } from "../../../hooks/use-platform";
import { cn } from "../../../lib/utils";
import { openWorkspacePath } from "../../../services/repo-client";
import { useChatStore } from "../../../store/chat-store";

interface ChatTopbarProps {
  workspace: WorkspaceSummary | null;
  conversation: Conversation | null;
  taskDetails?: ReactNode;
  liquidGlassEnabled?: boolean;
  resolvedTheme: "light" | "dark";
  runStatus: RunStatus;
  onCreateThread: () => void;
  onImportWorkspace: () => Promise<void>;
  onAppearanceChange: (appearance: Appearance) => void;
}

function toggleLivePanel() {
  window.dispatchEvent(new Event("mate:toggle-enhancement-panel"));
}

function sendLiveCommand(detail: {
  action?: "open" | "scan";
  view?: "trace" | "impact" | "validation" | "evidence";
}) {
  window.dispatchEvent(
    new CustomEvent("mate:enhancement-panel-command", { detail }),
  );
}

function TitlebarButton({
  children,
  onClick,
  liquidGlassEnabled = false,
  className,
}: {
  children?: ReactNode;
  onClick?: () => void;
  liquidGlassEnabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      size="xs"
      variant="outline"
      className={cn(
        "h-8 rounded-full border-border/55 px-3 text-[12px] font-medium text-foreground/85 shadow-none backdrop-blur-md hover:border-primary/35 hover:bg-primary/10 hover:text-primary",
        liquidGlassEnabled ? "bg-[var(--mate-panel-bg)]" : "bg-background/55",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function ChatTopbar({
  workspace,
  conversation,
  taskDetails,
  runStatus,
  onCreateThread,
}: ChatTopbarProps) {
  const { state } = useSidebar();
  const settings = useChatStore((state) => state.settings);
  const vibrancyMode = settings?.vibrancyMode ?? 'solid';
  const isSpecialMode = vibrancyMode === 'special';
  const liquidGlassEnabled = !isSpecialMode;

  const [openTarget, setOpenTarget] = useState<string>("folder");
  const [repoSafetyLabel, setRepoSafetyLabel] = useState<string>("Workspace safe");

  const platform = usePlatform();

  const title = conversation?.title ?? "No active thread";
  const eventCount = conversation?.messages.length ?? 0;
  const liveLabel =
    runStatus === "running"
      ? "Running"
      : eventCount > 0
        ? "Live"
        : "Ready";
  const liveTone =
    runStatus === "running"
      ? "border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 shadow-[0_0_12px_-3px_rgba(59,130,246,0.3)] transition-all duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]"
      : eventCount > 0
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]"
        : !isSpecialMode
          ? "border-transparent bg-[var(--mate-panel-bg)] text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-all duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]"
          : "border-transparent bg-background/40 text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-all duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]";
  const openSelectedTarget = () => {
    void openWorkspacePath(openTarget as "folder" | "vscode" | "terminal");
  };
  useEffect(() => {
    const handleRepoSafety = (event: Event) => {
      const label = (event as CustomEvent<{ label?: string }>).detail?.label;
      if (label) setRepoSafetyLabel(label);
    };
    window.addEventListener("mate:repo-safety-state", handleRepoSafety);
    return () => window.removeEventListener("mate:repo-safety-state", handleRepoSafety);
  }, []);

  return (
    <header
      className={cn(
        "drag-region sticky top-0 z-10 flex h-[52px] items-center justify-between gap-3 px-4 transition-[padding-left] duration-200 ease-linear",
        isSpecialMode
          ? "bg-transparent border-b border-[var(--titlebar-border)]/40"
          : "bg-[var(--titlebar)] border-b border-[var(--titlebar-border)]",
        state === "collapsed" && platform === "mac" && "pl-[88px]",
        platform === "windows" && "pr-[138px]",
      )}
    >
      <div className="relative z-10 flex min-w-0 items-center gap-2.5">
        <SidebarTrigger className="no-drag h-8 w-8 rounded-full bg-transparent text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground" />
        <h2 className="max-w-[300px] truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground/92 lg:max-w-[400px]">
          {title}
        </h2>
        {workspace ? (
          <span className="hidden rounded-full border border-border/60 bg-[var(--mate-panel-bg)] px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur-md min-[1180px]:inline-flex">
            {workspace.name}
          </span>
        ) : null}
        {runStatus === "running" ? (
          <span className="rounded-full bg-accent px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Running
          </span>
        ) : null}
        {workspace ? (
          <span className="hidden rounded-full border border-[var(--panel-border)]/45 bg-[var(--mate-panel-bg)] px-2 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur-md 2xl:inline-flex">
            {repoSafetyLabel}
          </span>
        ) : null}
      </div>

      <div className="no-drag relative z-10 flex shrink-0 items-center gap-2">
        <Menu>
          <MenuTrigger
            render={
              <TitlebarButton
                className={liveTone}
                liquidGlassEnabled={liquidGlassEnabled}
                onClick={toggleLivePanel}
              />
            }
          >
            {runStatus === "running" ? (
              <Loader2Icon className="size-3.5 animate-spin text-blue-400" />
            ) : eventCount > 0 ? (
              <div className="size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
            ) : (
              <ActivityIcon className="size-3.5 opacity-70" />
            )}
            <span className="font-medium tracking-tight">{liveLabel}</span>
            {eventCount > 0 && (
              <span className="rounded-full bg-current/15 px-1.5 py-0.5 text-[10px] font-semibold text-current">
                {eventCount}
              </span>
            )}
            <ChevronDownIcon className="size-3.5 opacity-50 transition-transform duration-200" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={() => sendLiveCommand({ action: "open" })}>
              <PanelRightIcon className="size-3.5" />
              Open panel
            </MenuItem>
            <MenuItem onClick={() => sendLiveCommand({ action: "scan" })}>
              <GitBranchIcon className="size-3.5" />
              Scan impact
            </MenuItem>
            <MenuItem onClick={() => sendLiveCommand({ view: "trace" })}>
              <ActivityIcon className="size-3.5" />
              TRACE
            </MenuItem>
            <MenuItem onClick={() => sendLiveCommand({ view: "impact" })}>
              <MapIcon className="size-3.5" />
              Impact
            </MenuItem>
            <MenuItem onClick={() => sendLiveCommand({ view: "validation" })}>
              <TargetIcon className="size-3.5" />
              Validation
            </MenuItem>
            <MenuItem onClick={() => sendLiveCommand({ view: "evidence" })}>
              <FileSearchIcon className="size-3.5" />
              Evidence
            </MenuItem>
          </MenuPopup>
        </Menu>
        <Menu>
          <MenuTrigger
            render={
              <TitlebarButton
                liquidGlassEnabled={liquidGlassEnabled}
                onClick={openSelectedTarget}
              />
            }
          >
            <ExternalLinkIcon className="size-3.5" />
            {openTarget === "folder"
              ? "Open"
              : openTarget === "vscode"
                ? "VS Code"
                : "Terminal"}
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem
              onClick={() => {
                setOpenTarget("folder");
                void openWorkspacePath("folder");
              }}
            >
              Open
            </MenuItem>
            <MenuItem
              onClick={() => {
                setOpenTarget("vscode");
                void openWorkspacePath("vscode");
              }}
            >
              Open in VS Code
            </MenuItem>
            <MenuItem
              onClick={() => {
                setOpenTarget("terminal");
                void openWorkspacePath("terminal");
              }}
            >
              Open in Terminal
            </MenuItem>
          </MenuPopup>
        </Menu>
        <Menu>
          <MenuTrigger
            render={
              <TitlebarButton
                liquidGlassEnabled={liquidGlassEnabled}
              />
            }
          >
            <GitBranchIcon className="size-3.5" />
            Git
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("mate:git-action", {
                    detail: { action: "commit" },
                  }),
                );
              }}
            >
              Commit
            </MenuItem>
            <MenuItem
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("mate:git-action", {
                    detail: { action: "commit-push" },
                  }),
                );
              }}
            >
              Commit &amp; push
            </MenuItem>
            <MenuItem
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("mate:git-action", {
                    detail: { action: "push-pr" },
                  }),
                );
              }}
            >
              Push &amp; PR
            </MenuItem>
          </MenuPopup>
        </Menu>
        {taskDetails ? (
          <div className="hidden min-[1120px]:block">{taskDetails}</div>
        ) : null}
        <Button
          aria-label="Create thread"
          size="icon-xs"
          variant="outline"
          className={cn(
            "size-8 rounded-full border-border/70 shadow-none backdrop-blur-md hover:bg-accent",
            liquidGlassEnabled
              ? "bg-[var(--mate-panel-bg)]"
              : "bg-background/65",
          )}
          onClick={onCreateThread}
        >
          <PlusIcon className="size-3.5" />
        </Button>
      </div>
    </header>
  );
}

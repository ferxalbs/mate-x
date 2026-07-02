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
import { useState, type ReactNode } from "react";

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
import { cn } from "../../../lib/utils";
import { openWorkspacePath } from "../../../services/repo-client";

interface ChatTopbarProps {
  workspace: WorkspaceSummary | null;
  conversation: Conversation | null;
  liquidGlassEnabled?: boolean;
  resolvedTheme: "light" | "dark";
  runStatus: RunStatus;
  onCreateThread: () => void;
  onImportWorkspace: () => Promise<void>;
  onAppearanceChange: (appearance: Appearance) => void;
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
  liquidGlassEnabled = false,
  runStatus,
  onCreateThread,
}: ChatTopbarProps) {
  const { state } = useSidebar();
  const [openTarget, setOpenTarget] = useState("folder");
  const [gitAction, setGitAction] = useState("commit-push");
  const title = conversation?.title ?? "No active thread";
  const eventCount = conversation?.messages.length ?? 0;
  const userTurns =
    conversation?.messages.filter((message) => message.role === "user")
      .length ?? 0;
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
        : liquidGlassEnabled
          ? "border-transparent bg-[var(--mate-panel-bg)] text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-all duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]"
          : "border-transparent bg-background/40 text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-all duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]";
  const toggleLivePanel = () => {
    window.dispatchEvent(new Event("mate:toggle-enhancement-panel"));
  };
  const sendLiveCommand = (detail: {
    action?: "open" | "scan";
    view?: "trace" | "impact" | "validation" | "evidence";
  }) => {
    window.dispatchEvent(
      new CustomEvent("mate:enhancement-panel-command", { detail }),
    );
  };
  const openSelectedTarget = () => {
    void openWorkspacePath(openTarget as "folder" | "vscode" | "terminal");
  };
  const runGitAction = () => {
    window.dispatchEvent(
      new CustomEvent("mate:git-action", { detail: { action: gitAction } }),
    );
    window.dispatchEvent(new Event("mate:toggle-git-panel"));
  };

  return (
    <header
      className={cn(
        "drag-region sticky top-0 z-10 flex h-[52px] items-center justify-between gap-3 px-4 transition-[padding-left] duration-200 ease-linear",
        liquidGlassEnabled
          ? "bg-transparent"
          : "glass border-b border-[var(--titlebar-border)]/40",
        state === "collapsed" && "pl-[88px]",
      )}
      style={
        {
          "--glass-bg": liquidGlassEnabled
            ? "color-mix(in srgb, var(--titlebar) 52%, transparent)"
            : "var(--titlebar)",
        } as any
      }
    >
      <div className="relative z-10 flex min-w-0 items-center gap-3">
        <SidebarTrigger className="no-drag h-8 w-8 rounded-full bg-transparent text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground" />
        <h2 className="truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground/92">
          {title}
        </h2>
        {workspace ? (
          <span className="rounded-full border border-border/60 bg-[var(--mate-panel-bg)] px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur-md">
            {workspace.name}
          </span>
        ) : null}
        {eventCount > 0 ? (
          <span className="hidden rounded-full border border-[var(--panel-border)]/45 bg-[var(--mate-panel-bg)] px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-md sm:inline-flex">
            {userTurns} turns
          </span>
        ) : null}
        {runStatus === "running" ? (
          <span className="rounded-full bg-accent px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Running
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
                onClick={runGitAction}
              />
            }
          >
            <GitBranchIcon className="size-3.5" />
            {gitAction === "commit-push"
              ? "Commit & push"
              : gitAction === "commit"
                ? "Commit"
                : "Push & PR"}
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem
              onClick={() => {
                setGitAction("commit");
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
                setGitAction("commit-push");
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
                setGitAction("push-pr");
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

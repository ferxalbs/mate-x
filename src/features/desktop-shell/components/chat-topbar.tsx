import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowUpRight01Icon, GitBranchIcon, Loading02Icon, Add01Icon, Shield01Icon } from "@hugeicons/core-free-icons";

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

function TitlebarButton({
  children,
  onClick,
  liquidGlassEnabled: _liquidGlassEnabled = false,
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
        "h-8 rounded-full border-border/55 px-3 text-[12px] font-medium text-foreground/85 shadow-none hover:border-primary/35 hover:bg-primary/10 hover:text-primary",
        "bg-mate-control-bg",
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
  runStatus,
  onCreateThread,
}: ChatTopbarProps) {
  const { state } = useSidebar();
  const settings = useChatStore((state) => state.settings);
  const vibrancyMode = settings?.vibrancyMode ?? "solid";
  // Solid panel fills for chrome controls; glass is reserved for floating surfaces.
  const liquidGlassEnabled = vibrancyMode === "solid" || vibrancyMode === "sidebar";

  const [openTarget, setOpenTarget] = useState<string>("folder");
  const [repoSafetyLabel, setRepoSafetyLabel] = useState<string>("Not proven");

  const platform = usePlatform();

  const title = conversation?.title ?? "No active thread";
  const contextualStatus = getContextualRunStatus(conversation, runStatus, repoSafetyLabel);
  const liveTone =
    runStatus === "running"
      ? "border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 shadow-none transition-[background-color,border-color,color,transform] duration-[var(--motion-press)] ease-[var(--ease-out)]"
      : "border-transparent bg-mate-control-bg text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-[background-color,border-color,color,transform] duration-[var(--motion-press)] ease-[var(--ease-out)]";
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
        "drag-region sticky top-0 z-10 flex h-[52px] items-center justify-between gap-3 px-4 transition-[padding,background-color] duration-300 ease-[var(--ease-apple)]",
        // Flat canvas titlebar — seamlessly integrated with app background.
        "border-b border-transparent bg-background",
        state === "collapsed" && platform === "mac" && "pl-[88px]",
        platform === "windows" && "pr-[138px]",
      )}
    >
      <div className="relative z-10 flex min-w-0 items-center gap-2.5">
        <SidebarTrigger className="no-drag h-8 w-8 rounded-full bg-transparent text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground" />
        <h2 className="max-w-[300px] truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground/92 lg:max-w-[400px]">
          {title}
        </h2>
      </div>

      <div className="no-drag relative z-10 flex min-w-0 shrink-0 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {workspace ? (
          <TitlebarButton
            className={liveTone}
            liquidGlassEnabled={liquidGlassEnabled}
            onClick={toggleLivePanel}
          >
            {runStatus === "running" ? (
              <HugeiconsIcon icon={Loading02Icon} className="size-3.5 animate-spin text-blue-400 motion-reduce:animate-none" />
            ) : (
              <HugeiconsIcon icon={Shield01Icon} className="size-3.5 opacity-70" />
            )}
            <span className="font-medium tracking-tight max-[1024px]:sr-only">
              {contextualStatus}
            </span>
          </TitlebarButton>
        ) : null}
        <Menu>
          <MenuTrigger
            render={
              <TitlebarButton liquidGlassEnabled={liquidGlassEnabled} />
            }
          >
            <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-3.5" />
            <span className="max-[1100px]:sr-only">
              {openTarget === "folder"
                ? "Open"
                : openTarget === "vscode"
                  ? "VS Code"
                  : "Terminal"}
            </span>
            <HugeiconsIcon icon={ArrowDown01Icon} className="size-3.5 text-muted-foreground max-[900px]:hidden" />
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
            <HugeiconsIcon icon={GitBranchIcon} className="size-3.5" />
            <span className="max-[1100px]:sr-only">Git</span>
            <HugeiconsIcon icon={ArrowDown01Icon} className="size-3.5 text-muted-foreground max-[900px]:hidden" />
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
        <Button
          aria-label="Create thread"
          size="icon-xs"
          variant="outline"
          className={cn(
            "size-8 rounded-full border-border/70 bg-mate-control-bg shadow-none hover:bg-accent",
          )}
          onClick={onCreateThread}
        >
          <HugeiconsIcon icon={Add01Icon} className="size-3.5" />
        </Button>
      </div>
    </header>
  );
}

export function getContextualRunStatus(
  conversation: ChatTopbarProps["conversation"],
  runStatus: ChatTopbarProps["runStatus"],
  fallback: string,
) {
  const latestOutcome = [...(conversation?.messages ?? [])].reverse().find((message) => message.executionOutcome)?.executionOutcome;
  if (runStatus === "running") {
    const behavior = conversation?.runs?.at(-1)?.initialState.settings.behaviorMode;
    return behavior === "review" ? "Reviewing" : behavior === "plan" ? "Planning" : "Working";
  }
  if (latestOutcome?.completionKind === "awaiting_approval") return "Approval required";
  if (latestOutcome?.terminalState === "blocked") return "Blocked";
  if (latestOutcome?.terminalState === "failed") return "Failed";
  if (latestOutcome?.completionKind === "changed_unverified" && latestOutcome.evidence.validation.status === "not_run") return "Done · Check unavailable";
  if (latestOutcome?.terminalState === "completed" || latestOutcome?.completionKind === "changed_verified") return "Done";
  return fallback;
}

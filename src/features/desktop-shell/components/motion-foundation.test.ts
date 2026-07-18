import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("responsive motion foundation", () => {
  test("defines the canonical motion curves and durations", () => {
    const theme = readSource("../../../styles/themes/base.css");

    assert.ok(theme.includes("--ease-out: cubic-bezier(0.23, 1, 0.32, 1)"));
    assert.ok(theme.includes("--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)"));
    assert.ok(theme.includes("--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)"));
    assert.ok(theme.includes("--motion-press: 150ms"));
    assert.ok(theme.includes("--motion-tooltip: 150ms"));
    assert.ok(theme.includes("--motion-menu: 180ms"));
    assert.ok(theme.includes("--motion-drawer: 250ms"));
  });

  test("keeps high-frequency chat surfaces free of ornamental entrances", () => {
    const command = readSource("../../../components/ui/command.tsx");
    const messageStream = readSource("./message-stream.tsx");
    const emptyChatState = readSource("./empty-chat-state.tsx");

    assert.ok(command.includes("autoFocus"));
    assert.doesNotMatch(command, /data-(?:starting|ending)-style/);
    assert.doesNotMatch(
      messageStream,
      new RegExp(["animate-in", "slide-in-from", "fade-in", ["transition", "all"].join("-")].join("|")),
    );
    assert.doesNotMatch(emptyChatState, /animate-in|slide-in-from|fade-in/);
  });

  test("uses restrained press and scroll-edge feedback with reduced-motion fallbacks", () => {
    const button = readSource("../../../components/ui/button.tsx");
    const drawer = readSource("../../../components/ui/drawer.tsx");
    const messageScroller = readSource("../../../components/ui/message-scroller.tsx");
    const quickActions = readSource("./quick-action-cards.tsx");

    assert.ok(button.includes("active:not-aria-[haspopup]:scale-[0.97]"));
    assert.ok(button.includes("motion-reduce:transform-none"));
    assert.ok(
      drawer.includes(
        "transform-[translate3d(var(--translate-x,0px),var(--translate-y,0px),0)_scale(var(--stack-scale))]",
      ),
    );
    assert.ok(drawer.includes("motion-reduce:transition-none"));
    assert.ok(!drawer.includes("motion-reduce:transform-none"));
    assert.ok(messageScroller.includes("duration-[var(--motion-menu)]"));
    assert.ok(messageScroller.includes("data-[active=false]:scale-95"));
    assert.ok(messageScroller.includes("motion-reduce:data-[active=false]:scale-100"));
    assert.ok(!quickActions.includes("domMax"));
    assert.ok(quickActions.includes("motion-reduce:transform-none"));
  });

  test("does not animate layout measurements and preserves the intentional tab spring", () => {
    const composerDock = readSource("./composer-dock.tsx");
    const sidebar = readSource("../../../components/ui/sidebar.tsx");
    const enhancementChrome = readSource("./enhancement-panel-chrome.tsx");

    assert.doesNotMatch(composerDock, /transition-\[(?:left|right|width|padding|height)/);
    assert.doesNotMatch(sidebar, /transition-\[(?:left|right|width|padding|height)/);
    assert.ok(enhancementChrome.includes("layoutId=\"activeTabEnhancement\""));
    assert.ok(enhancementChrome.includes("RESPONSIVE_SPRING"));
  });
});

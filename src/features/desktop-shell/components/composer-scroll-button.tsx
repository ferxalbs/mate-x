import { MessageScrollerButton } from "../../../components/ui/message-scroller";

export function ComposerScrollButton() {
  return (
    <MessageScrollerButton
      aria-label="Scroll to latest message"
      direction="end"
      placement="composer"
      title="Scroll to latest message"
      className="rounded-full border-[var(--panel-border)]/60 bg-[var(--panel)]/42 shadow-none backdrop-blur-xl hover:bg-[var(--panel)]"
    />
  );
}

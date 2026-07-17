import { MessageScrollerButton } from "../../../components/ui/message-scroller";

export function ComposerScrollButton() {
  return (
    <MessageScrollerButton
      aria-label="Scroll to latest message"
      direction="end"
      placement="composer"
      title="Scroll to latest message"
      className="mate-glass-float rounded-full border-panel-border/60 bg-panel shadow-none hover:bg-panel"
    />
  );
}

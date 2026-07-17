import { MessageScrollerButton } from "../../../components/ui/message-scroller";

export function ComposerScrollButton() {
  return (
    <MessageScrollerButton
      aria-label="Scroll to latest message"
      direction="end"
      placement="composer"
      title="Scroll to latest message"
      className="mate-glass-float rounded-full border-panel-border/60 bg-mate-control-bg shadow-none hover:bg-mate-control-bg"
    />
  );
}

import type { LinearWebhookEnvelope } from "../../contracts/linear-integration";

export class LinearRelayClient {
  private socket: WebSocket | null = null;
  private stopped = false;
  private retryMs = 1_000;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly accept: (envelope: LinearWebhookEnvelope) => Promise<boolean>,
    private readonly onConnectionChange: (connected: boolean) => void = () => undefined,
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
  }

  private connect(): void {
    if (this.stopped) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "auth", token: this.token }));
      this.retryMs = 1_000;
      this.onConnectionChange(true);
    });
    socket.addEventListener("message", (event) => void this.handle(String(event.data)));
    socket.addEventListener("close", () => {
      this.onConnectionChange(false);
      if (!this.stopped) setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 30_000);
    });
  }

  private async handle(raw: string): Promise<void> {
    const value = JSON.parse(raw) as LinearWebhookEnvelope & { type?: string };
    if (value.type !== "delivery") return;
    await this.accept(value);
    this.socket?.send(JSON.stringify({ type: "ack", deliveryId: value.deliveryId }));
  }
}

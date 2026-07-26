import type { LinearWebhookEnvelope } from "../../contracts/linear-integration";
import { powerStateService } from "../power-state-service";

export class LinearRelayClient {
  private socket: WebSocket | null = null;
  private stopped = false;
  private retryMs = 1_000;
  private retryTimer: NodeJS.Timeout | null = null;
  private unsubscribePowerState: (() => void) | null = null;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly accept: (envelope: LinearWebhookEnvelope) => Promise<boolean>,
    private readonly onConnectionChange: (connected: boolean) => void = () => undefined,
  ) {}

  start(): void {
    this.stop();
    this.stopped = false;
    this.retryMs = 1_000;
    this.unsubscribePowerState = powerStateService.subscribe(
      () => this.handlePowerState(),
      true,
    );
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.unsubscribePowerState?.();
    this.unsubscribePowerState = null;
    this.socket?.close();
    this.socket = null;
  }

  private handlePowerState(): void {
    if (this.stopped) return;
    if (!powerStateService.canRunBackgroundWork()) {
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      const hadSocket = this.socket !== null;
      this.socket?.close();
      this.socket = null;
      if (hadSocket) this.onConnectionChange(false);
      return;
    }

    if (!this.socket) {
      this.connect();
    }
  }

  private connect(): void {
    if (this.stopped || !powerStateService.canRunBackgroundWork()) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "auth", token: this.token }));
      this.retryMs = 1_000;
      this.onConnectionChange(true);
    });
    socket.addEventListener("message", (event) => void this.handle(String(event.data)));
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.onConnectionChange(false);
      if (!this.stopped && powerStateService.canRunBackgroundWork()) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.connect();
        }, this.retryMs);
      }
      this.retryMs = Math.min(this.retryMs * 2, 30_000);
    });
  }

  private async handle(raw: string): Promise<void> {
    let value: LinearWebhookEnvelope & { type?: string };
    try {
      value = JSON.parse(raw) as LinearWebhookEnvelope & { type?: string };
    } catch {
      return;
    }
    if (value.type !== "delivery") return;
    await this.accept(value);
    this.socket?.send(JSON.stringify({ type: "ack", deliveryId: value.deliveryId }));
  }
}

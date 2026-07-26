import {
  canRunBackgroundWork,
  DEFAULT_POWER_STATE,
  type PowerStatePayload,
} from "../contracts/power";

type PowerStateListener = (state: PowerStatePayload) => void;

export class PowerStateService {
  private state: PowerStatePayload = DEFAULT_POWER_STATE;
  private readonly listeners = new Set<PowerStateListener>();

  getState(): PowerStatePayload {
    return { ...this.state };
  }

  update(next: Partial<PowerStatePayload>): PowerStatePayload {
    const candidate: PowerStatePayload = {
      ...this.state,
      ...next,
      speedLimit: clampSpeedLimit(next.speedLimit ?? this.state.speedLimit),
    };

    if (isEqual(this.state, candidate)) {
      return this.state;
    }

    this.state = candidate;
    for (const listener of this.listeners) {
      listener({ ...this.state });
    }
    return this.state;
  }

  subscribe(listener: PowerStateListener, emitCurrent = false): () => void {
    this.listeners.add(listener);
    if (emitCurrent) {
      listener(this.state);
    }
    return () => this.listeners.delete(listener);
  }

  canRunBackgroundWork(): boolean {
    return canRunBackgroundWork(this.state);
  }
}

function clampSpeedLimit(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 100;
}

function isEqual(left: PowerStatePayload, right: PowerStatePayload): boolean {
  return left.onBattery === right.onBattery
    && left.suspended === right.suspended
    && left.thermalState === right.thermalState
    && left.speedLimit === right.speedLimit;
}

export const powerStateService = new PowerStateService();

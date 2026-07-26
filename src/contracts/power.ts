export type ThermalState = "unknown" | "nominal" | "fair" | "serious" | "critical";

export interface PowerStatePayload {
  onBattery: boolean;
  suspended: boolean;
  thermalState: ThermalState;
  speedLimit: number;
}

export const DEFAULT_POWER_STATE: PowerStatePayload = {
  onBattery: false,
  suspended: false,
  thermalState: "nominal",
  speedLimit: 100,
};

export function canRunBackgroundWork(state: PowerStatePayload): boolean {
  if (state.suspended || state.onBattery) {
    return false;
  }

  return state.thermalState !== "serious"
    && state.thermalState !== "critical"
    && state.speedLimit >= 75;
}

export function shouldReduceBackgroundWork(state: PowerStatePayload): boolean {
  return state.suspended
    || state.onBattery
    || state.thermalState === "fair"
    || state.thermalState === "serious"
    || state.thermalState === "critical"
    || state.speedLimit < 100;
}

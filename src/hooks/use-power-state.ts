import { useEffect, useState } from 'react';
import { DEFAULT_POWER_STATE, type PowerStatePayload } from '../contracts/power';

export function usePowerState(): PowerStatePayload {
  const [powerState, setPowerState] = useState<PowerStatePayload>(DEFAULT_POWER_STATE);

  useEffect(() => {
    const applyPowerState = (payload: PowerStatePayload) => {
      setPowerState(payload);
      document.documentElement.classList.toggle('on-battery', payload.onBattery);
      document.documentElement.classList.toggle('power-suspended', payload.suspended);
      document.documentElement.dataset.thermalState = payload.thermalState;
    };

    if (!window.mate?.ui) return;

    const cleanup = window.mate.ui.onPowerStateChanged?.(applyPowerState);
    const getPowerState = window.mate.ui.getPowerState;
    if (getPowerState) {
      void getPowerState().then(applyPowerState).catch(() => undefined);
    }

    return () => {
      cleanup?.();
      document.documentElement.classList.remove('on-battery', 'power-suspended');
      delete document.documentElement.dataset.thermalState;
    };
  }, []);

  return powerState;
}

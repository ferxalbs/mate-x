import { useEffect, useState } from 'react';
import type { PowerStatePayload } from '../contracts/ipc';

export function usePowerState(): PowerStatePayload {
  const [powerState, setPowerState] = useState<PowerStatePayload>({
    onBattery: false,
    suspended: false,
  });

  useEffect(() => {
    if (!window.mate?.ui?.onPowerStateChanged) return;

    const cleanup = window.mate.ui.onPowerStateChanged((payload) => {
      setPowerState(payload);
      if (payload.onBattery) {
        document.documentElement.classList.add('on-battery');
      } else {
        document.documentElement.classList.remove('on-battery');
      }
    });

    return cleanup;
  }, []);

  return powerState;
}

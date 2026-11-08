import { useCallback } from 'react';
import { useStorage } from './context/useStorage';
import { unlockWithBiometrics } from './useBiometrics';

/** Read the saved policy at submission. A read error must not disable authentication. */
export function usePaymentAuthorization() {
  const { getItem } = useStorage();
  return useCallback(async (): Promise<boolean> => {
    const enabled = await getItem('Biometrics');
    return !enabled || (await unlockWithBiometrics()) === true;
  }, [getItem]);
}

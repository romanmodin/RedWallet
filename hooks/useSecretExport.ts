import { useCallback } from 'react';
import prompt from '../helpers/prompt';
import presentAlert from '../components/Alert';
import { useStorage } from './context/useStorage';
import { unlockWithBiometrics } from './useBiometrics';

/** Reauthenticate at the secret boundary, even if app-unlock biometrics are disabled. */
export function useSecretExport() {
  const { cachedPassword, isPasswordInUse } = useStorage();
  return useCallback(async (): Promise<boolean> => {
    try {
      if (cachedPassword) {
        const password = await prompt('Confirm wallet password', 'Enter your storage password to reveal or copy a wallet secret.');
        // A decoy bucket's password must not authorize export of the active bucket.
        if (password === cachedPassword && (await isPasswordInUse(password))) return true;
        presentAlert({ message: 'Incorrect wallet password.' });
        return false;
      }
      if (await unlockWithBiometrics()) return true;
      presentAlert({
        message: 'Authenticate with your device, or enable a storage password in Settings before exporting a wallet secret.',
      });
      return false;
    } catch {
      // Canceling a password prompt is not an error and never grants access.
      return false;
    }
  }, [cachedPassword, isPasswordInUse]);
}

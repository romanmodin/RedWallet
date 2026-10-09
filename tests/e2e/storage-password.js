import { element } from 'detox';
import { confirmPasswordDialog, waitForId } from './helperz';

// Keep iOS keyboard entry unsynchronized, then restore synchronization before
// destination checks so queued native navigation work can finish.
export async function submitStoragePassword(password, confirmation, settled) {
  const isIOS = device.getPlatform() === 'ios';
  let synchronizationDisabled = false;
  if (isIOS) {
    await device.disableSynchronization();
    synchronizationDisabled = true;
  }
  try {
    await waitForId('PasswordInput');
    // Focus before editing (secure fields clear on focus), and explicitly clear
    // retained input when retrying after an expected wrong-password alert.
    await element(by.id('PasswordInput')).tap();
    await element(by.id('PasswordInput')).clearText();
    await element(by.id('PasswordInput')).typeText(password);
    if (confirmation) {
      await waitForId('ConfirmPasswordInput');
      await element(by.id('ConfirmPasswordInput')).tap();
      await element(by.id('ConfirmPasswordInput')).clearText();
      await element(by.id('ConfirmPasswordInput')).typeText(password);
    }
    if (isIOS) {
      await element(by.id(confirmation ? 'ConfirmPasswordInput' : 'PasswordInput')).tapReturnKey();
    }
    await confirmPasswordDialog();
    if (synchronizationDisabled) {
      await device.enableSynchronization();
      synchronizationDisabled = false;
    }
    await settled();
  } finally {
    if (synchronizationDisabled) await device.enableSynchronization();
  }
}

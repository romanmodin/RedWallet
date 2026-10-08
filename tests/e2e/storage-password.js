import { element } from 'detox';
import { confirmPasswordDialog, waitForId } from './helperz';

// iOS secure keyboard animations can keep Detox busy after a return-key
// action. Dismiss the keyboard with synchronization off, then use the dialog
// button and bounded destination checks before restoring synchronization.
export async function submitStoragePassword(password, confirmation, settled) {
  const isIOS = device.getPlatform() === 'ios';
  if (isIOS) await device.disableSynchronization();
  try {
    await waitForId('PasswordInput');
    // Both secure inputs clear on focus. Enter text only after focusing,
    // otherwise tapReturnKey can focus and erase an unfocused confirmation.
    await element(by.id('PasswordInput')).tap();
    await element(by.id('PasswordInput')).typeText(password);
    if (confirmation) {
      await waitForId('ConfirmPasswordInput');
      await element(by.id('ConfirmPasswordInput')).tap();
      await element(by.id('ConfirmPasswordInput')).typeText(password);
    }
    if (isIOS) {
      await element(by.id(confirmation ? 'ConfirmPasswordInput' : 'PasswordInput')).tapReturnKey();
    }
    await confirmPasswordDialog();
    await settled();
  } finally {
    if (isIOS) await device.enableSynchronization();
  }
}

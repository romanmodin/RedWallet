import { element, waitFor } from 'detox';
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

// On a freshly relaunched iOS secure field, typing the password and newline in
// one action can submit a partial value. Verify the complete fixture password
// before sending Return; callers still assert the actual unlocked wallet.
export async function enterUnlockPassword(password) {
  await waitForId('PasswordInput');
  const input = element(by.id('PasswordInput'));
  await input.tap();
  await input.replaceText(password);
  await waitFor(input).toHaveText(password).withTimeout(5000);
  await input.tapReturnKey();
}

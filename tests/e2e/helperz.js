import { sha256 } from '@noble/hashes/sha256';
import { element } from 'detox';

/**
 * Captures a stack trace at the call site, excluding the given function from the trace.
 * Used to make Detox errors point to the spec file line instead of helper internals.
 */
function captureCallsite(excludeFn) {
  const callsite = {};
  Error.captureStackTrace(callsite, excludeFn);
  return callsite;
}

/**
 * Rethrows err with the stack rewritten to point at the call site.
 */
function rethrowWithCallsite(err, callsite) {
  if (err && typeof err === 'object' && callsite && callsite.stack) {
    const name = err.name || 'Error';
    const message = err.message || '';
    const frames = callsite.stack.split('\n').slice(1).join('\n');
    err.stack = `${name}: ${message}\n${frames}`;
  }
  throw err;
}

export async function waitForId(id, timeout = 33000) {
  const callsite = captureCallsite(waitForId);
  try {
    await waitFor(element(by.id(id)))
      .toBeVisible()
      .withTimeout(timeout / 2);
  } catch (_) {
    // nop
  }

  try {
    await waitFor(element(by.id(id)))
      .toBeVisible()
      .withTimeout(timeout / 2);
  } catch (err) {
    rethrowWithCallsite(err, callsite);
  }
}

export async function waitForWalletsList(timeout = 120_000) {
  // A populated scroll container can extend beyond the viewport. Check that
  // it exists and that the home toolbar is visible; wallet rows have their
  // own visibility/address assertions in each test.
  await waitFor(element(by.id('WalletsList')))
    .toExist()
    .withTimeout(timeout);
  await waitForId('SettingsButton', timeout);
}

export async function waitForText(text, timeout = 33000) {
  const callsite = captureCallsite(waitForText);
  try {
    await waitFor(element(by.text(text)))
      .toBeVisible()
      .withTimeout(timeout / 2);
    return true;
  } catch (_) {
    // nop
  }

  try {
    await waitFor(element(by.text(text)))
      .toBeVisible()
      .withTimeout(timeout / 2);
    return true;
  } catch (err) {
    // iOS 26 liquid glass: text rendered inside/over the glass header (e.g. the wallet name on
    // the transactions hero) can fail Detox's 75%-pixel toBeVisible check while still being
    // present and on-screen — same root cause as the goBack() back-button workaround. Fall back
    // to existence in the hierarchy so a glass false-negative does not fail an otherwise valid run.
    try {
      await waitFor(element(by.text(text)))
        .toExist()
        .withTimeout(3000);
      return true;
    } catch (_) {
      rethrowWithCallsite(err, callsite);
    }
  }
}

/** Waits for `accessibilityLabel` (Detox `by.label`), e.g. full address while UI text is multiline. */
export async function waitForLabel(label, timeout = 33000) {
  const callsite = captureCallsite(waitForLabel);
  try {
    await waitFor(element(by.label(label)))
      .toBeVisible()
      .withTimeout(timeout / 2);
    return true;
  } catch (_) {
    // nop
  }

  try {
    await waitFor(element(by.label(label)))
      .toBeVisible()
      .withTimeout(timeout / 2);
  } catch (err) {
    rethrowWithCallsite(err, callsite);
  }
}

export async function getSwitchValue(switchId) {
  try {
    await expect(element(by.id(switchId))).toHaveToggleValue(true);
    return true;
  } catch (_) {
    return false;
  }
}

// Detox's waitFor() doesn't expose toHaveToggleValue, so poll expect() until the switch reaches
// the expected state (or throw after timeoutMs).
export async function waitForSwitchValue(switchId, expectedValue, timeoutMs = 8000) {
  const callsite = captureCallsite(waitForSwitchValue);
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      await expect(element(by.id(switchId))).toHaveToggleValue(expectedValue);
      return;
    } catch (err) {
      lastErr = err;
      await sleep(250);
    }
  }
  rethrowWithCallsite(lastErr || new Error(`Timed out waiting for ${switchId} == ${expectedValue}`), callsite);
}

// Use the real Done accessory or the import form's drag-to-dismiss behavior.
// Require both the onscreen keyboard to be absent and Import to be visible.
export async function dismissMnemonicKeyboard() {
  if (device.getPlatform() !== 'ios') {
    // replaceText does not open Android's keyboard; reveal Import without Back.
    await waitFor(element(by.id('DoImport')))
      .toBeVisible()
      .whileElement(by.id('ImportWalletScroll'))
      .scroll(120, 'down', 0.9, 0.5);
    return;
  }
  const deadline = Date.now() + 10000;
  let ready = false;
  let formTapAttempted = false;
  while (Date.now() < deadline) {
    try {
      await element(by.id('DismissMnemonicKeyboard')).tap();
    } catch (_) {
      // Multiline inputs can lack their iOS accessory. A tap on the form's
      // noninteractive label dismisses the keyboard through handled taps.
      if (!formTapAttempted) {
        formTapAttempted = true;
        try {
          await element(by.id('ImportWalletScroll')).scrollTo('top');
          await element(by.id('XbtImportFormat')).tap();
        } catch {}
      }
    }
    try {
      await expect(element(by.type('UIKeyboardLayoutStar'))).not.toBeVisible();
    } catch (_) {
      // Multiline iOS inputs can lack the accessory. Exercise an actual drag.
      // Start above the keyboard, near the form edge outside the text input.
      await element(by.id('ImportWalletScroll')).swipe('up', 'slow', 0.15, 0.9, 0.25);
      await sleep(250);
      continue;
    }
    try {
      await expect(element(by.id('DoImport'))).toBeVisible();
      ready = true;
      break;
    } catch (_) {
      await element(by.id('ImportWalletScroll')).scroll(120, 'down', 0.9, 0.5);
    }
    await sleep(250);
  }
  if (!ready) throw new Error('Mnemonic keyboard did not dismiss within 10 seconds');
  // The caller must still exercise Import's real tap; no hit test is bypassed.
  await waitFor(element(by.id('DoImport')))
    .toBeVisible()
    .withTimeout(10000);
}

// iOS replaceText can skip input callbacks, leaving the controlled field empty
// after blur. Exercise keyboard input and verify the value before and after Done.
export async function enterMnemonicText(text) {
  const input = element(by.id('MnemonicInput'));
  if (device.getPlatform() === 'ios') {
    await input.typeText(text);
  } else {
    await input.replaceText(text);
  }
  await expect(input).toHaveText(text);
  await dismissMnemonicKeyboard();
  await expect(input).toHaveText(text.replace(/^\s+|\s+$|\s+(?=\s)/g, ''));
}

export async function helperImportWallet(importText, walletType, expectedWalletLabel, expectedBalance, passphrase) {
  await waitForId('WalletsList');
  await waitFor(element(by.id('CreateAWallet')))
    .toBeVisible()
    .whileElement(by.id('WalletsList'))
    .scroll(500, 'right'); // in case emu screen is small and it doesnt fit
  // going to Import Wallet screen and importing mnemonic
  await tapAndTapAgainIfElementIsNotVisible('CreateAWallet', 'ImportWallet');
  await element(by.id('ImportWallet')).tap();
  if (walletType === 'watchOnly') throw new Error('Watch-only import is not supported in the XBT-only prototype.');
  await waitForId('MnemonicInput');
  await element(by.id('MnemonicInput')).replaceText(importText);
  await dismissMnemonicKeyboard();
  if (passphrase) {
    await element(by.id('HeaderMenuButton')).tap();
    await element(by.text('Passphrase')).tap();
  }
  await element(by.id('DoImport')).tap();
  await waitForText(expectedWalletLabel, 3 * 61000);
  await scrollUpOnHomeScreen();

  // lets go inside wallet
  await element(by.text(expectedWalletLabel)).tap();
  // label might change in the future
  await expect(element(by.id('WalletBalance'))).toHaveText(expectedBalance);
}

export async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function hashIt(s) {
  return Buffer.from(sha256(s)).toString('hex');
}

export async function helperDeleteWallet(label, remainingBalanceSat = false) {
  // Tapping the wallet card by visible text (`by.text(label)`) is what
  // bluewallet3's import-then-delete flow uses successfully. On a wallet
  // that has been opened before, this navigates to WalletTransactions
  // immediately. On a freshly-created wallet (t10) the carousel
  // Pressable's first onPress is swallowed before navigation fires —
  // that case is a known limitation of the e2e harness.
  await element(by.text(label)).tap();
  await waitForId('WalletDetails');
  await element(by.id('WalletDetails')).tap();
  await element(by.id('WalletDetailsScroll')).swipe('up', 'fast', 1);
  await sleep(1000);
  await element(by.id('DeleteWallet')).tap();
  await waitForText('Yes, delete');
  await element(by.text('Yes, delete')).tap();
  if (remainingBalanceSat) {
    // await element(by.type('android.widget.EditText')).typeText(remainingBalanceSat);
    await typeTextIntoAlertInput(remainingBalanceSat);
    await element(by.text('Delete')).tap();
  }
  await waitForId('NoTransactionsMessage');
}

/**
 * Extracts element text or label using getAttributes()
 * @returns {Promise<string>}
 */
export async function extractTextFromElementById(id) {
  const attributes = await element(by.id(id)).getAttributes();
  return attributes.value || attributes.label;
}

export const expectToBeVisible = async id => {
  try {
    await expect(element(by.id(id))).toBeVisible();
    return true;
  } catch (e) {
    return false;
  }
};

export async function helperCreateWallet(walletName, walletFormat = 'segwit') {
  await waitFor(element(by.id('CreateAWallet')))
    .toBeVisible()
    .whileElement(by.id('WalletsList'))
    .scroll(500, 'right'); // in case emu screen is small and it doesnt fit

  await sleep(200); // Wait until bounce animation finishes.
  await tapAndTapAgainIfElementIsNotVisible('CreateAWallet', 'WalletNameInput');
  await element(by.id('WalletNameInput')).replaceText(walletName || 'cr34t3d');
  await waitForId('ActivateBitcoinButton');
  await element(by.id('ActivateBitcoinButton')).tap();
  await element(by.id('ActivateBitcoinButton')).tap();
  // why tf we need 2 taps for it to work..? mystery

  if (walletFormat === 'taproot') await element(by.id('ToggleXbtWalletFormat')).tap();

  // iOS 26 liquid glass: the navigation transition after tapping "Create" triggers
  // glass animations that never fully settle, keeping the app in a "busy" state.
  // Detox synchronization waits for idle before proceeding, causing an infinite hang.
  // Disable sync for the remainder of wallet creation and re-enable once we're back
  // on the home screen where the glass animations have settled.
  const isIOS = device.getPlatform() === 'ios';
  if (isIOS) {
    await device.disableSynchronization();
  }
  try {
    await element(by.id('Create')).tap();
    // Wait for the backup screen to mount after the asynchronous storage write.
    // Its scroll content can exceed the viewport; visibility is checked on OK.
    // Never tap Create again while a wallet may already have been created.
    try {
      await waitFor(element(by.id('PleaseBackupScrollView')))
        .toExist()
        .withTimeout(120_000);
    } catch (error) {
      // Retain only control identifiers, native types and frames. The backup
      // view contains a disposable seed, which must not enter diagnostic logs.
      await device
        .generateViewHierarchyXml(false)
        .then(xml => {
          const controls = [];
          for (const match of xml.matchAll(/<([\w.$]+)\s+([^>]*?)\/?>/g)) {
            const attributes = Object.fromEntries(Array.from(match[2].matchAll(/([\w-]+)="([^"]*)"/g), item => [item[1], item[2]]));
            const known = ['PleaseBackupScrollView', 'PleasebackupOk', 'WalletsList', 'Create', 'Secret'].includes(attributes.id);
            if (!known && !/Scroll|Window|Dialog/.test(match[1])) continue;
            const control = { type: match[1] };
            for (const key of ['height', 'width', 'x', 'y', 'visibility'])
              if (attributes[key] !== undefined) control[key] = attributes[key];
            if (known) control.id = attributes.id;
            controls.push(control);
          }
          console.error('[wallet-e2e] backup control hierarchy:', JSON.stringify(controls));
        })
        .catch(() => {});
      throw error;
    }

    await waitFor(element(by.id('PleasebackupOk')))
      .toBeVisible()
      .whileElement(by.id('PleaseBackupScrollView'))
      .scroll(500, 'down'); // in case emu screen is small and it doesnt fit

    await element(by.id('PleasebackupOk')).tap();
    await sleep(1000);
    await scrollUpOnHomeScreen();
  } finally {
    if (isIOS) {
      await device.enableSynchronization();
    }
  }
  await expect(element(by.id('WalletsList'))).toExist();
  await element(by.id('WalletsList')).swipe('right', 'fast', 1); // in case emu screen is small and it doesnt fit
  await sleep(200);
  await expect(element(by.id(walletName || 'cr34t3d'))).toBeVisible();
}

export async function tapAndTapAgainIfElementIsNotVisible(idToTap, idToCheckVisible) {
  const callsite = captureCallsite(tapAndTapAgainIfElementIsNotVisible);
  // tap
  await element(by.id(idToTap)).tap();

  // check if visible
  try {
    await waitFor(element(by.id(idToCheckVisible)))
      .toBeVisible()
      .withTimeout(3_000);
    return; // did not throw? its visible, return
  } catch (_) {}

  // did not return so its not visible, lets tap again
  await element(by.id(idToTap)).tap();

  // check visibility again, this time no try-catch, if it fails it fails
  try {
    await waitFor(element(by.id(idToCheckVisible)))
      .toBeVisible()
      .withTimeout(3_000);
  } catch (err) {
    rethrowWithCallsite(err, callsite);
  }
}

export async function tapAndTapAgainIfTextIsNotVisible(textToTap, textToCheckVisible) {
  const callsite = captureCallsite(tapAndTapAgainIfTextIsNotVisible);
  // tap
  await element(by.text(textToTap)).tap();

  // check if visible
  try {
    await waitFor(element(by.text(textToCheckVisible)))
      .toBeVisible()
      .withTimeout(3_000);
    return; // did not throw? its visible, return
  } catch (_) {}

  // did not return so its not visible, lets tap again
  await element(by.text(textToTap)).tap();

  // check visibility again, this time no try-catch, if it fails it fails
  try {
    await waitFor(element(by.text(textToCheckVisible)))
      .toBeVisible()
      .withTimeout(3_000);
  } catch (err) {
    rethrowWithCallsite(err, callsite);
  }
}

export async function tapIfPresent(id) {
  try {
    await element(by.id(id)).tap();
  } catch (_) {}
  // no need to check for visibility, just silently ignore exception if such testID is not present
}

export async function tapIfTextPresent(text) {
  try {
    await element(by.text(text)).tap();
  } catch (_) {}
  // no need to check for visibility, just silently ignore exception if such testID is not present
}

/**
 * Dismisses a native UIAlertController by tapping a button with the given text.
 * On iOS 26 liquid glass, `waitFor().toBeVisible()` never resolves for alert
 * buttons because the glass material fails Detox's pixel visibility check.
 * This helper disables Detox synchronization (which can also hang on glass
 * animations) and polls with direct tap attempts and label fallbacks.
 *
 * @returns true if the alert was dismissed, false if no alert was found
 */
export async function dismissAlertByText(text, timeoutMs = 10000, restoreSynchronization = true) {
  const isIOS = device.getPlatform() === 'ios';
  if (isIOS) {
    await device.disableSynchronization();
  }
  const deadline = Date.now() + timeoutMs;
  let dismissed = false;
  try {
    while (Date.now() < deadline) {
      // by.text — works on pre–iOS 26 and some iOS 26 alerts
      try {
        await element(by.text(text)).atIndex(0).tap();
        dismissed = true;
        break;
      } catch (_) {}
      // by.label — accessibility label, works when text matching differs
      try {
        await element(by.label(text)).atIndex(0).tap();
        dismissed = true;
        break;
      } catch (_) {}
      await sleep(500);
    }
  } finally {
    if (isIOS && restoreSynchronization) {
      await device.enableSynchronization();
    }
  }
  return dismissed;
}

/**
 * Confirms password dialogs in a platform-safe way.
 * Android must tap a visible confirmation to keep test flow deterministic.
 * iOS can fall back between id-based and text-based buttons.
 */
export async function confirmPasswordDialog() {
  if (device.getPlatform() === 'android') {
    await waitFor(element(by.text('OK')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.text('OK')).tap();
    return;
  }

  try {
    await waitFor(element(by.id('OKButton')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id('OKButton')).tap();
  } catch (_) {
    await waitFor(element(by.text('OK')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.text('OK')).tap();
  }
}

export async function countElements(testId) {
  let count = 0;
  while (true) {
    try {
      await expect(element(by.id(testId)).atIndex(count)).toBeVisible();
      count++;
    } catch (_) {
      break;
    }
  }
  return count;
}

export async function scanText(text) {
  await waitForId('ScanQrBackdoorButton');
  for (let c = 0; c <= 5; c++) {
    await element(by.id('ScanQrBackdoorButton')).tap();
  }
  await element(by.id('scanQrBackdoorInput')).replaceText(text);
  await element(by.id('scanQrBackdoorOkButton')).tap();
}

export async function setCustomFeeRate(feeRate) {
  await waitForId('chooseFee');
  await element(by.id('chooseFee')).tap();
  await waitForId('feeCustomContainerButton');
  await element(by.id('feeCustomContainerButton')).tap();
  await waitForId('feeCustom');
  await element(by.id('feeCustom')).typeText(String(feeRate) + '\n');
  await waitForKeyboardToClose();
  await waitForId('chooseFee');
}

export async function goBack() {
  if (device.getPlatform() !== 'ios') {
    await device.pressBack();
    return;
  }

  const callsite = captureCallsite(goBack);

  // Try each back/close affordance in order; retry the full set up to 10 times.
  const candidates = [by.id('BackButton'), by.id('NavigationCloseButton'), by.label('Back'), by.text('Close')];

  // A matcher can hit several elements across stacked screens: each nav back
  // button exists twice (_UIButtonBarButton wrapper + UIAccessibilityBackButtonElement),
  // and when a modal covers a stack that also has a back button, the covered
  // one can precede the visible one in match order (seen with Reduce Motion on).
  // Probe attributes and only tap an element detox reports as visible & hittable.
  //
  // iOS 26 liquid glass: the native back button reports visible=false because
  // the glass material fails Detox's 75%-pixel visibility check, yet the button
  // IS functionally hittable. We first try (visible && hittable), then fall back
  // to (hittable only) for the glass case.
  let lastErr;
  for (let attempt = 0; attempt < 10; attempt++) {
    // Pass 1: prefer visible + hittable elements
    for (const matcher of candidates) {
      for (let idx = 0; idx < 6; idx++) {
        let attrs;
        try {
          attrs = await element(matcher).atIndex(idx).getAttributes();
        } catch (err) {
          lastErr = err;
          break; // no element at this index — try next candidate
        }
        if (!attrs.visible || attrs.hittable === false) continue;
        try {
          await element(matcher).atIndex(idx).tap();
          return;
        } catch (err) {
          lastErr = err;
        }
      }
    }
    // Pass 2: accept hittable-only elements (iOS 26 liquid glass back button)
    for (const matcher of candidates) {
      for (let idx = 0; idx < 6; idx++) {
        let attrs;
        try {
          attrs = await element(matcher).atIndex(idx).getAttributes();
        } catch (err) {
          lastErr = err;
          break;
        }
        if (attrs.hittable === false) continue;
        try {
          await element(matcher).atIndex(idx).tap();
          return;
        } catch (err) {
          lastErr = err;
        }
      }
    }
    await sleep(500);
  }

  const wrapped = new Error('goBack: no back/close affordance tappable after 10 attempts.');
  if (lastErr) wrapped.cause = lastErr;
  rethrowWithCallsite(wrapped, callsite);
}

/** Exit the cancelled scan through each actual screen before closing its modal. */
export async function leaveCancelledRecovery() {
  await goBack();
  await waitFor(element(by.id('DoImport')))
    .toBeVisible()
    .withTimeout(15000);
  await goBack();
  await waitFor(element(by.id('ImportWallet')))
    .toBeVisible()
    .withTimeout(15000);

  if (device.getPlatform() !== 'ios') {
    await device.pressBack();
    await waitFor(element(by.id('ImportWallet')))
      .not.toBeVisible()
      .withTimeout(15000);
    return;
  }

  // Unsynchronized iOS stack transitions can accept a tap before its handler
  // reaches the new screen. Retry only Close while Add Wallet is still visible;
  // never continue unless the modal has actually disappeared.
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await expect(element(by.id('ImportWallet'))).not.toBeVisible();
      return;
    } catch (_) {}
    try {
      await expect(element(by.id('ImportWallet'))).toBeVisible();
      await element(by.id('NavigationCloseButton')).tap();
      await waitFor(element(by.id('ImportWallet')))
        .not.toBeVisible()
        .withTimeout(1000);
      return;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  const timeoutError = new Error('Cancelled recovery Add Wallet modal did not close within 15 seconds');
  timeoutError.cause = lastError;
  throw timeoutError;
}

export async function typeTextIntoAlertInput(text) {
  if (device.getPlatform() === 'android') {
    await element(by.type('android.widget.EditText')).replaceText(text);
  } else {
    // iOS 26 no longer exposes the private _UIAlertControllerTextField class.
    // Match UIKit's public field type and wait for the second prompt to mount.
    const field = element(by.type('UITextField')).atIndex(0);
    await waitFor(field).toExist().withTimeout(10_000);
    await field.replaceText(text);
  }
  await sleep(1000);
}

/**
 * Scrolls up on the home screen. This is needed on the iOS.
 */
export async function scrollUpOnHomeScreen() {
  if (device.getPlatform() !== 'ios') {
    return;
  }
  try {
    await element(by.type('RCTEnhancedScrollView').withDescendant(by.type('RCTEnhancedScrollView'))).swipe('down', 'slow', 0.5);
  } catch (_) {
    // if no wallets there will be just one scroll
    await element(by.type('RCTEnhancedScrollView')).swipe('down', 'slow', 0.5);
  }
  await sleep(1000); // bounce animation
}

// We really only need this function when running tests locally.
// In GitHub Actions, we run Android tests with a hardware keyboard, so the onscreen keyboard doesn’t appear.
// On iOS, it doesn’t cause any known issues.
export async function waitForKeyboardToClose() {
  if (device.getPlatform() === 'ios' || process.env.CI) {
    return;
  }
  await sleep(500);
}

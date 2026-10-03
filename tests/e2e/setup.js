/* eslint-env jest */
/* global device */

// Detox's iOS network synchronization waits on all in-flight NSURLSession
// requests before considering the app idle. The Arkade SDK's indexer opens
// a long-lived SSE-style stream (`expo/fetch` →
// /v1/indexer/script/subscription/<id>) that never completes during the
// test's lifetime, so every action would time out waiting for idle.
//
// Tell Detox to ignore that endpoint. The blacklist is process-scoped on
// iOS, so we re-apply it after every launchApp.
const URL_BLACKLIST = ['.*arkade\\.computer/v1/indexer/script/subscription.*', '.*groundcontrol-bluewallet\\.herokuapp\\.com.*'];

beforeAll(async () => {
  if (typeof device === 'undefined' || !device?.launchApp) return;

  const originalLaunchApp = device.launchApp.bind(device);
  device.launchApp = async (...args) => {
    let result;
    try {
      result = await originalLaunchApp(...args);
    } catch (error) {
      console.error('[detox-setup] launch failed:', error?.stack || error?.message || error);
      // iOS simulator Keychain resets can crash SpringBoard before the app
      // launches. Retry that specific system-shell failure once; app crashes,
      // connection errors and test assertions still fail without retry.
      const message = String(error?.stack || error?.message || error);
      if (
        device.getPlatform() !== 'ios' ||
        !/system shell.*SpringBoard.*crashed|NSPOSIXErrorDomain.*(?:code[:= ]+64|Code=64)/i.test(message)
      )
        throw error;
      console.error('[detox-setup] retrying launch after simulator system-shell failure');
      result = await originalLaunchApp(...args);
    }
    try {
      await device.setURLBlacklist(URL_BLACKLIST);
    } catch (e) {
      console.log('[detox-setup] setURLBlacklist after launchApp failed:', e?.message ?? e);
    }
    return result;
  };

  // Detox auto-launches the app before the first beforeAll; cover that launch too.
  try {
    await device.setURLBlacklist(URL_BLACKLIST);
  } catch (e) {
    console.log('[detox-setup] initial setURLBlacklist failed:', e?.message ?? e);
  }
});

// Reset only Detox's selected disposable simulator before the unchanged self-test.
// Its public reset API stops artifact recording, shuts down, erases Keychain and
// app data, invalidates install state, then boots through the device lifecycle.
// Direct simctl shutdown bypassed those hooks and timed out in 39465258897.
async function resetSelftestDevice(device) {
  if (device.getPlatform() === 'ios') {
    const id = device.id;
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid self-test simulator identity');
    await device.terminateApp();
    let timer;
    try {
      // Preserve the previous aggregate 30s shutdown + 30s boot + 90s readiness
      // budget. A stalled reset fails closed; never retry or launch over it.
      await Promise.race([
        device.resetContentAndSettings(),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Self-test simulator reset exceeded 150 seconds')), 150000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  } else {
    await device.clearKeychain();
  }
  await device.launchApp({ delete: true });
}
module.exports = { resetSelftestDevice };

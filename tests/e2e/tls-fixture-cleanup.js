// Disposable empty-wallet TLS fixtures only. Never used by wallet operations.
async function cleanupTlsFixture(device, server, sockets) {
  try {
    // Release Node handles before any native idle wait can stall teardown.
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  } finally {
    try {
      if (device.getPlatform() === 'ios') {
        // All TLS assertions have already run (or failed). The settings screen
        // can remain busy after its alert closes. Remove disposable saved server
        // settings too: the closed fixture must not trigger reconnect on launch.
        // This uses the same empty-state reset as each TLS scenario, without retrying
        // a TLS connection assertion or any wallet action.
        await device.clearKeychain();
        await device.launchApp({ delete: true, permissions: { notifications: 'NO' } });
        await device.enableSynchronization();
      }
    } finally {
      await device.terminateApp();
    }
  }
}

module.exports = { cleanupTlsFixture };

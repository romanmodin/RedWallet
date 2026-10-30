// Disposable empty-wallet TLS fixtures only. Never used by wallet operations.
async function cleanupTlsFixture(device, server, sockets) {
  try {
    // Release Node handles before any native command can stall teardown.
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  } finally {
    try {
      await device.terminateApp();
    } finally {
      // No cleanup relaunch: it used to add two more shell resets and could
      // leave an old async test launching during the next certificate case.
      // Remove the disposable saved endpoint. The next case clears Keychain
      // with a verified shell-readiness barrier before its only clean launch.
      if (device.getPlatform() === 'ios') await device.uninstallApp();
    }
  }
}
module.exports = { cleanupTlsFixture };

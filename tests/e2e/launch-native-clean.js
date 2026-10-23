// Initial native-lifecycle launch only. Uninstall/install preserves the clean app
// state required by the case without terminating a process that does not exist.
async function launchNativeClean(device, options) {
  if (device.getPlatform() === 'ios') {
    await device.uninstallApp();
    await device.installApp();
    await device.launchApp({ ...options, newInstance: false });
  } else {
    await device.launchApp({ ...options, delete: true });
  }
}
module.exports = { launchNativeClean };

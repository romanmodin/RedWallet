// Test driver only. replaceText focuses the single-line host field on iOS.
// Scroll only after Return dismisses the keyboard and native visibility confirms
// its animation has finished; disabled Detox synchronization cannot do this for us.
async function settleIosHostKeyboard({ device, element, by, waitFor }, host) {
  if (device.getPlatform() !== 'ios') return;
  // The host testID is omitted by this native hierarchy. Match the edited value,
  // never the former default preset after replaceText has changed it.
  const editedHost = element(by.type('RCTUITextField').and(by.value(host)));
  await editedHost.tapReturnKey();
  await waitFor(element(by.type('UIKeyboardLayoutStar')))
    .not.toBeVisible()
    .withTimeout(15000);
}
module.exports = { settleIosHostKeyboard };

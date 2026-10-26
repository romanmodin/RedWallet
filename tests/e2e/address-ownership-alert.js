/* Detox may wait for a native alert to disappear before resolving the tap
 * that opened it. Disable synchronization only across this modal interaction;
 * keep the visible ownership-result assertion and restore synchronization.
 */
async function checkAddressOwnershipAlert({ device, element, by, expect }) {
  await device.disableSynchronization();
  try {
    await element(by.id('CheckAddress')).tap();
    await expect(element(by.text('None of the available wallets own the provided address.'))).toBeVisible();
    await element(by.text('OK')).tap();
  } finally {
    await device.enableSynchronization();
  }
}
module.exports = { checkAddressOwnershipAlert };

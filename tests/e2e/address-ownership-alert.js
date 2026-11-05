/* The iOS driver can deadlock when synchronization is re-enabled while the
 * keyboard regains focus after alert dismissal. Assert the ownership result,
 * leave that screen, and observe the destination before restoring idle tracking.
 */
async function checkAddressOwnershipAlert({ device, element, by, expect, leaveAddressScreen }) {
  await device.disableSynchronization();
  try {
    await element(by.id('CheckAddress')).tap();
    await expect(element(by.text('None of the available wallets own the provided address.'))).toBeVisible();
    await element(by.text('OK')).tap();
    await leaveAddressScreen();
  } catch (error) {
    // Preserve a real assertion failure; restart only for cleanup, never to
    // retry the action or accept an absent ownership result.
    console.warn('Address ownership interaction failed:', error.message);
    await device.launchApp({ newInstance: true });
    throw error;
  } finally {
    await device.enableSynchronization();
  }
}
module.exports = { checkAddressOwnershipAlert };

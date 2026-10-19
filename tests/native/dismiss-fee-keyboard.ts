/** Only retries the harmless keyboard Done action; never accepts a wallet action. */
export async function dismissFeeKeyboard(driver: {
  tapDone: () => Promise<unknown>;
  assertKeyboardVisible: () => Promise<unknown>;
  waitClosed: (timeoutMs: number) => Promise<unknown>;
  now?: () => number;
}): Promise<void> {
  const now = driver.now || Date.now;
  const deadline = now() + 10_000;
  const remaining = () => {
    const milliseconds = deadline - now();
    if (milliseconds <= 0) throw new Error('Fee keyboard did not close before the original 10-second deadline');
    return milliseconds;
  };
  await driver.tapDone();
  try {
    await driver.waitClosed(Math.min(3_000, remaining()));
    return;
  } catch (error) {
    // A completed visibility timeout permits one observed, idempotent dismissal.
    // Tap failures, transport errors and unresolved native requests must fail closed.
    if (
      !(error instanceof Error) ||
      !error.message.includes('Timed out while waiting for expectation: NOT TOBEVISIBLE') ||
      !error.message.includes('UIKeyboardLayoutStar')
    ) {
      throw error;
    }
  }
  remaining();
  await driver.assertKeyboardVisible();
  remaining();
  await driver.tapDone();
  await driver.waitClosed(remaining());
}

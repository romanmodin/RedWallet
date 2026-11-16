export type NativeTestOutcome = {
  passed: boolean;
  testError?: string;
  cleanupError?: string;
};

const describeError = (error: unknown) => (error instanceof Error ? error.stack || error.message : String(error));

/** Always attempt the receipt; cleanup must not replace the original failure. */
export async function runWithNativeReceipt(actions: {
  run: () => Promise<void>;
  cleanup: () => Promise<void>;
  writeReceipt: (outcome: NativeTestOutcome) => void | Promise<void>;
}): Promise<void> {
  let testFailure: { error: unknown } | undefined;
  let cleanupFailure: { error: unknown } | undefined;
  let receiptFailure: { error: unknown } | undefined;
  try {
    await actions.run();
  } catch (error) {
    testFailure = { error };
  }
  try {
    await actions.cleanup();
  } catch (error) {
    cleanupFailure = { error };
  }
  try {
    await actions.writeReceipt({
      passed: !testFailure && !cleanupFailure,
      ...(testFailure ? { testError: describeError(testFailure.error) } : {}),
      ...(cleanupFailure ? { cleanupError: describeError(cleanupFailure.error) } : {}),
    });
  } catch (error) {
    receiptFailure = { error };
    console.error('Native test receipt could not be written:', error);
  }
  if (testFailure) throw testFailure.error;
  if (cleanupFailure) throw cleanupFailure.error;
  if (receiptFailure) throw receiptFailure.error;
}

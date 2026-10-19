/** Read-only assertions only: never use this polling helper for taps or wallet actions. */
export async function observeNativeCondition(
  label: string,
  assertion: () => Promise<unknown>,
  timeoutMs: number,
  requestTimeoutMs = 10_000,
  intervalMs = 250,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unresponsive = false;
    try {
      await Promise.race([
        assertion(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => {
              unresponsive = true;
              reject(new Error(label + ': native observation did not respond'));
            },
            Math.min(requestTimeoutMs, deadline - Date.now()),
          );
        }),
      ]);
      return;
    } catch (error) {
      // A pending native request must never be queued again. Fail into teardown
      // so diagnostics/backend receipts survive instead of Jest timing out first.
      if (unresponsive) throw error;
      lastError = error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
  }
  throw new Error(label + ': condition not met before deadline' + (lastError instanceof Error ? ': ' + lastError.message : ''));
}

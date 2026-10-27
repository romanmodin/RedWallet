// Diagnostic-only boundary: never retries, skips assertions or changes application state.
export async function observeNativeSetupStep(name, action, record, timeoutMs = 60000) {
  const started = Date.now();
  record({ name, status: 'started', started });
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(action),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Native setup step timed out: ' + name)), timeoutMs);
      }),
    ]);
    record({ name, status: 'passed', elapsedMs: Date.now() - started });
    return result;
  } catch (error) {
    record({ name, status: 'failed', elapsedMs: Date.now() - started });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Diagnostic only: never retries an action or treats a timeout as success.
export async function diagnosticStep(label, action, timeoutMs = 30000, report = console.info) {
  const started = Date.now();
  report({ label, state: 'start', timeoutMs });
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(action),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Diagnostic timeout: ${label} after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    report({ label, state: 'done', elapsedMs: Date.now() - started });
    return result;
  } catch (error) {
    report({ label, state: 'failed', elapsedMs: Date.now() - started });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

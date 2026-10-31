/** Bound one native interaction. Never retry an action whose outcome is uncertain. */
export async function nativeActionOnce<T>(label: string, action: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid native action deadline');
  let timer: ReturnType<typeof setTimeout> | undefined;
  console.info('[native-action] ' + label + ' started');
  try {
    const result = await Promise.race([
      Promise.resolve().then(action),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(label + ': native action did not respond; outcome unknown; do not retry')), timeoutMs);
      }),
    ]);
    console.info('[native-action] ' + label + ' returned');
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

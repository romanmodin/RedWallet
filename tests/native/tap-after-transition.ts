/**
 * Detox hit-testing runs before touch delivery. Retry only the known iOS alert
 * transition obstruction; never repeat a successful tap or an ambiguous failure.
 */
export async function tapAfterTransition(
  tap: () => Promise<unknown>,
  pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
) {
  for (let attempt = 0; ; attempt++) {
    try {
      await tap();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= 19 || !message.includes('View is not hittable at its visible point') || !/- Hit: <UITransitionView[ :]/.test(message))
        throw error;
      await pause(250);
    }
  }
}

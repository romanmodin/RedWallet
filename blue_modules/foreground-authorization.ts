import { AppState, Platform } from 'react-native';

/** Authenticate once, then allow submission only from the same foreground screen. */
export async function authorizeInForeground(authorize: () => Promise<boolean>, isCurrent: () => boolean): Promise<boolean> {
  const isActive = () => AppState.currentState === 'active';
  if (!isCurrent() || !isActive()) return false;
  let leftApp = false;
  let resume: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Remember a real background transition even if the user returns before the
  // authentication promise resolves. A later foreground event cannot revive it.
  const subscription = AppState.addEventListener('change', state => {
    if (state !== 'active' && state !== 'inactive') leftApp = true;
    if (state !== 'inactive') resume?.();
  });
  try {
    if ((await authorize()) !== true || leftApp || !isCurrent()) return false;
    if (Platform.OS === 'ios' && AppState.currentState === 'inactive') {
      // Face ID can finish before iOS reports active. Wait briefly for its
      // dismissal; never submit while inactive or after entering the background.
      await new Promise<void>(resolve => {
        resume = resolve;
        timer = setTimeout(resolve, 3000);
      });
    }
    return !leftApp && isCurrent() && AppState.currentState === 'active';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    subscription.remove();
  }
}

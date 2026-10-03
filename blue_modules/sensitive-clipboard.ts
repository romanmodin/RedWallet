import Clipboard from '@react-native-clipboard/clipboard';
import { AppState, NativeEventSubscription, TurboModuleRegistry, TurboModule } from 'react-native';

type SensitiveClipboardModule = TurboModule & {
  setSensitiveString(value: string): void;
};

export const SECRET_CLIPBOARD_TTL_MS = 30_000;
let secret: string | undefined;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let subscription: NativeEventSubscription | undefined;

/** Clear only our copied secret, preserving an address or other text copied afterward. */
export async function clearSensitiveClipboard(): Promise<void> {
  const value = secret;
  const currentGeneration = generation;
  if (value === undefined) return;
  try {
    const clipboard = await Clipboard.getString();
    if (currentGeneration !== generation) return;
    if (clipboard === value) Clipboard.setString('');
  } finally {
    if (currentGeneration === generation) {
      secret = undefined;
      if (timer) clearTimeout(timer);
      timer = undefined;
      subscription?.remove();
      subscription = undefined;
    }
  }
}

export function copySensitiveClipboard(value: string): void {
  if (AppState.currentState && AppState.currentState !== 'active') return;
  const native = TurboModuleRegistry.getEnforcing<SensitiveClipboardModule>('RNCClipboard');
  if (typeof native.setSensitiveString !== 'function') throw new Error('Secure clipboard copying is unavailable in this build');
  native.setSensitiveString(value);
  generation++;
  secret = value;
  if (timer) clearTimeout(timer);
  subscription?.remove();
  const clear = () => {
    // Native pasteboard errors must not expose the secret in logs.
    clearSensitiveClipboard().catch(() => {});
  };
  subscription = AppState.addEventListener('change', state => {
    if (state !== 'active') clear();
  });
  timer = setTimeout(clear, SECRET_CLIPBOARD_TTL_MS);
}

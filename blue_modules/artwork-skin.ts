import { useSyncExternalStore, useEffect } from 'react';
import DefaultPreference from 'react-native-default-preference';
import { GROUP_IO_BLUEWALLET } from './currency';

export const ARTWORK_SKIN_KEY = 'optional_artwork_skin_v1';
export const ARTWORK_DOUBLE_TAP_MS = 450;
let enabled = false;
let loaded: Promise<void> | undefined;
let queue = Promise.resolve();
const listeners = new Set<() => void>();

const snapshot = () => enabled;
export const getArtworkSkin = snapshot;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function loadArtworkSkin(): Promise<void> {
  loaded ??= (async () => {
    try {
      await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
      const saved = await DefaultPreference.get(ARTWORK_SKIN_KEY);
      enabled = saved === 'enabled';
      listeners.forEach(listener => listener());
    } catch {
      // Cosmetic persistence failures keep the original appearance.
      enabled = false;
    }
  })();
  return loaded;
}

export function toggleArtworkSkin(): Promise<void> {
  const next = queue.then(async () => {
    await loadArtworkSkin();
    const value = !enabled;
    await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
    await DefaultPreference.set(ARTWORK_SKIN_KEY, value ? 'enabled' : 'disabled');
    enabled = value;
    listeners.forEach(listener => listener());
  });
  queue = next.catch(() => {});
  return next;
}

export function useArtworkSkin(): boolean {
  const active = useSyncExternalStore(subscribe, snapshot, () => false);
  useEffect(() => {
    loadArtworkSkin().catch(() => {});
  }, []);
  return active;
}

/** Single taps or unrelated taps never change the skin. */
export function isArtworkDoubleTap(previous: number | undefined, current: number): boolean {
  return previous !== undefined && current >= previous && current - previous <= ARTWORK_DOUBLE_TAP_MS;
}

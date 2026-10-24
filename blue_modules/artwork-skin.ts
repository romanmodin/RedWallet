import { useSyncExternalStore, useEffect } from 'react';
import DefaultPreference from 'react-native-default-preference';
import { GROUP_IO_BLUEWALLET } from './currency';

export const ARTWORK_SKIN_KEY = 'optional_artwork_skin_v1';
export type ArtworkSkin = 'off' | 'helmet' | 'armour';
export const ARTWORK_SKINS: readonly ArtworkSkin[] = ['off', 'helmet', 'armour'];
let selected: ArtworkSkin = 'off';
let loaded: Promise<void> | undefined;
let queue = Promise.resolve();
const listeners = new Set<() => void>();

const snapshot = () => selected;
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
      selected = saved === 'enabled' || saved === 'helmet' ? 'helmet' : saved === 'armour' ? 'armour' : 'off';
      listeners.forEach(listener => listener());
    } catch {
      // Cosmetic persistence failures keep the original appearance.
      selected = 'off';
    }
  })();
  return loaded;
}

export function toggleArtworkSkin(): Promise<void> {
  const next = queue.then(async () => {
    await loadArtworkSkin();
    const value = ARTWORK_SKINS[(ARTWORK_SKINS.indexOf(selected) + 1) % ARTWORK_SKINS.length];
    await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
    await DefaultPreference.set(ARTWORK_SKIN_KEY, value);
    selected = value;
    listeners.forEach(listener => listener());
  });
  queue = next.catch(() => {});
  return next;
}

export function useArtworkSkinSelection(): ArtworkSkin {
  const selection = useSyncExternalStore(subscribe, snapshot, () => 'off' as const);
  useEffect(() => {
    loadArtworkSkin().catch(() => {});
  }, []);
  return selection;
}

export function useArtworkSkin(): boolean {
  return useArtworkSkinSelection() !== 'off';
}

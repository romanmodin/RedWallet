// blockExplorer.ts
import DefaultPreference from 'react-native-default-preference';
import { XBT_PROFILE } from '../class/xbt/profile';

export interface BlockExplorer {
  key: string;
  name: string;
  url: string;
}

// No explorer has been verified for this XBT profile. Never inherit BTC defaults.
export const BLOCK_EXPLORERS: { [key: string]: BlockExplorer } = {
  default: { key: 'default', name: 'Unavailable', url: '' },
};

export const getBlockExplorersList = (): BlockExplorer[] => {
  return XBT_PROFILE.explorerEnabled ? Object.values(BLOCK_EXPLORERS) : [];
};

export const normalizeUrl = (url: string): string => {
  return url.replace(/\/+$/, '');
};

export const isValidUrl = (url: string): boolean => {
  const pattern = /^(https?:\/\/)/;
  return pattern.test(url);
};

/** A single guard for open, copy, and Handoff links. Missing support yields no URL. */
export const getTransactionExplorerUrl = (txid?: string): string | undefined => {
  if (!XBT_PROFILE.explorerEnabled || !txid) return undefined;
  const url = BLOCK_EXPLORERS.default.url;
  return isValidUrl(url) ? `${normalizeUrl(url)}/tx/${txid}` : undefined;
};

export const findMatchingExplorerByDomain = (url: string): BlockExplorer | null => {
  const domain = getDomain(url);
  if (!XBT_PROFILE.explorerEnabled || !domain) return null;
  for (const explorer of Object.values(BLOCK_EXPLORERS)) {
    if (getDomain(explorer.url) === domain) {
      return explorer;
    }
  }
  return null;
};

export const getDomain = (url: string): string => {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const BLOCK_EXPLORER_STORAGE_KEY = 'blockExplorer';

export const saveBlockExplorer = async (url: string): Promise<boolean> => {
  // Arbitrary custom URLs cannot establish which chain an explorer indexes.
  if (!XBT_PROFILE.explorerEnabled && url) return false;
  try {
    await DefaultPreference.set(BLOCK_EXPLORER_STORAGE_KEY, url);
    return true;
  } catch (error) {
    console.error('Error saving block explorer:', error);
    return false;
  }
};

export const removeBlockExplorer = async (): Promise<boolean> => {
  try {
    await DefaultPreference.clear(BLOCK_EXPLORER_STORAGE_KEY);
    return true;
  } catch (error) {
    console.error('Error removing block explorer:', error);
    return false;
  }
};

export const getBlockExplorerUrl = async (): Promise<string> => {
  // Ignore saved upstream/custom URLs until an XBT explorer is independently verified.
  return BLOCK_EXPLORERS.default.url;
};

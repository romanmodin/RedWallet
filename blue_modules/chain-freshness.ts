import DefaultPreference from 'react-native-default-preference';
import * as BlueElectrum from './BlueElectrum';
import { GROUP_IO_BLUEWALLET } from './currency';
import { assessChain, ChainStatus, ReferenceResult, serverLabel, validateReferenceUrl } from '../class/xbt/chain-freshness';
import { isXbtMainnetCheckpointHeader, XBT_MAINNET_CHECKPOINT_HEIGHT } from '../class/xbt/electrum-checkpoint';

const HOME_REFERENCE_KEY = 'chain_home_reference_v1';
const PUBLIC_BASE = 'https://mempool.guide/api/';
const HTTP_TIMEOUT_MS = 8000;

async function text(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'error',
      headers: { Accept: 'application/json, text/plain' },
    });
    if (!response.ok) throw new Error('Chain reference unavailable');
    const result = await response.text();
    if (result.length > 4096) throw new Error('Oversized chain reference response');
    return result.trim();
  } finally {
    clearTimeout(timer);
  }
}

function validHeight(height: unknown): number {
  const value = Number(height);
  if (!Number.isSafeInteger(value) || value < XBT_MAINNET_CHECKPOINT_HEIGHT || value > 100_000_000) {
    throw new Error('Invalid XBT reference height');
  }
  return value;
}

export async function getHomeReference(): Promise<{ url: string; host: string; port: string } | undefined> {
  await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
  const raw = await DefaultPreference.get(HOME_REFERENCE_KEY);
  if (!raw) return undefined;
  try {
    const saved = JSON.parse(String(raw));
    return {
      url: validateReferenceUrl(saved.url),
      host: String(saved.host),
      port: String(saved.port),
    };
  } catch {
    return undefined;
  }
}

export async function setHomeReference(url: string): Promise<void> {
  const normalized = validateReferenceUrl(url);
  await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
  if (!normalized) {
    await DefaultPreference.clear(HOME_REFERENCE_KEY);
    return;
  }
  const config = await BlueElectrum.getConfig();
  const preferred = await BlueElectrum.getPreferredServer();
  const host = config.host || preferred?.host;
  const port = config.port || preferred?.ssl || preferred?.tcp;
  if (!host || !port) throw new Error('Save an Electrum server before linking its Knots reference.');
  await DefaultPreference.set(HOME_REFERENCE_KEY, JSON.stringify({ url: normalized, host, port: String(port) }));
}

/** Only heights and serialized block headers are requested; never addresses or balances. */
export async function checkChain(previous?: ChainStatus): Promise<ChainStatus> {
  const config = await BlueElectrum.getConfig();
  const label = serverLabel(config.serverName);
  const base = {
    serverLabel: label,
    checkedAt: Date.now(),
    verifiedAt: previous?.verifiedAt,
    references: [],
  };
  try {
    const reader = BlueElectrum.createChainFreshnessReader();
    const tip = await reader.tip();
    const height = validHeight(tip.height);
    const publicRead = async (): Promise<ReferenceResult> => {
      const publicHeight = validHeight(await text(`${PUBLIC_BASE}blocks/tip/height`));
      const checkpointHash = await text(`${PUBLIC_BASE}block-height/${XBT_MAINNET_CHECKPOINT_HEIGHT}`);
      if (!/^[0-9a-f]{64}$/i.test(checkpointHash)) throw new Error('Invalid checkpoint hash');
      const checkpoint = await text(`${PUBLIC_BASE}block/${checkpointHash}/header`);
      if (!isXbtMainnetCheckpointHeader(checkpoint)) throw new Error('Reference is not XBT');
      const comparisonHeight = Math.max(XBT_MAINNET_CHECKPOINT_HEIGHT, Math.min(height, publicHeight) - 6);
      const hash = await text(`${PUBLIC_BASE}block-height/${comparisonHeight}`);
      if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error('Invalid reference block hash');
      const [referenceHeader, localHeader] = await Promise.all([
        text(`${PUBLIC_BASE}block/${hash}/header`),
        reader.header(comparisonHeight),
      ]);
      if (!/^[0-9a-f]{328}$/i.test(referenceHeader)) throw new Error('Invalid XBT reference header');
      return {
        source: 'mempool.guide',
        height: publicHeight,
        comparisonHeight,
        matches: referenceHeader.toLowerCase() === localHeader.toLowerCase(),
      };
    };
    const homeRead = async (): Promise<ReferenceResult> => {
      const home = await getHomeReference();
      if (!home || home.host !== config.host || home.port !== String(config.port)) throw new Error('No Knots reference for this server');
      const first = JSON.parse(await text(`${home.url}?height=${XBT_MAINNET_CHECKPOINT_HEIGHT}`));
      const homeHeight = validHeight(first.height);
      if (first.comparisonHeight !== XBT_MAINNET_CHECKPOINT_HEIGHT || !isXbtMainnetCheckpointHeader(first.header)) {
        throw new Error('Knots reference is not XBT');
      }
      const comparisonHeight = Math.max(XBT_MAINNET_CHECKPOINT_HEIGHT, Math.min(height, homeHeight) - 6);
      const [reference, localHeader] = await Promise.all([
        text(`${home.url}?height=${comparisonHeight}`).then(JSON.parse),
        reader.header(comparisonHeight),
      ]);
      if (reference.comparisonHeight !== comparisonHeight || !/^[0-9a-f]{328}$/i.test(reference.header))
        throw new Error('Invalid Knots header');
      return {
        source: 'Knots',
        height: homeHeight,
        comparisonHeight,
        matches: reference.header.toLowerCase() === localHeader.toLowerCase(),
      };
    };
    const results = await Promise.allSettled([publicRead(), homeRead()]);
    reader.assertCurrent();
    const references = results.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []));
    const candidate = assessChain(height, references, false);
    const repeated =
      !!previous &&
      previous.source === candidate.source &&
      ['suspect', 'behind', 'disagreement'].includes(previous.state) &&
      Date.now() - (previous.checkedAt || 0) >= 60_000;
    const assessment = assessChain(height, references, repeated);
    return {
      ...base,
      ...assessment,
      height,
      references,
      verifiedAt: assessment.state === 'verified' ? Date.now() : base.verifiedAt,
    };
  } catch {
    return {
      ...base,
      state: 'unverified',
      message: 'Your wallet connection could not be verified. Saved addresses remain available; balances may be cached.',
    };
  }
}

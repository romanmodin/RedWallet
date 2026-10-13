import * as Electrum from '../../blue_modules/BlueElectrum';
import DefaultPreference from 'react-native-default-preference';
import { checkChain, setHomeReference } from '../../blue_modules/chain-freshness';
import { XBT_MAINNET_CHECKPOINT_HEADER } from '../../class/xbt/electrum-checkpoint';

jest.mock('../../blue_modules/BlueElectrum', () => ({
  getConfig: jest.fn(),
  getPreferredServer: jest.fn(),
  createChainFreshnessReader: jest.fn(),
}));
jest.mock('../../blue_modules/currency', () => ({
  GROUP_IO_BLUEWALLET: 'group',
}));
jest.mock('react-native-default-preference', () => ({
  setName: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  clear: jest.fn(),
}));

const checkpoint = XBT_MAINNET_CHECKPOINT_HEADER;
const header = '01'.repeat(164);
const requested: string[] = [];
let height = 977037;
let referenceHeight = 977037;
let current = true;
let publicOffline = false;
let home: string | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  requested.length = 0;
  height = referenceHeight = 977037;
  current = true;
  publicOffline = false;
  home = undefined;
  (Electrum.getConfig as jest.Mock).mockResolvedValue({
    host: 'home.example',
    port: 50002,
    serverName: 'Fulcrum 2.1.2',
    connected: 1,
  });
  (Electrum.createChainFreshnessReader as jest.Mock).mockImplementation(() => ({
    tip: async () => ({ height }),
    header: async () => header,
    assertCurrent: () => {
      if (!current) throw new Error('changed');
    },
  }));
  (DefaultPreference.get as jest.Mock).mockImplementation(async () => home);
  global.fetch = jest.fn(async (input: any) => {
    const url = String(input);
    requested.push(url);
    if (url.startsWith('https://mempool.guide') && publicOffline) throw new Error('offline');
    let body: string;
    if (url.startsWith('https://home.example/chain')) {
      const h = Number(new URL(url).searchParams.get('height'));
      body = JSON.stringify({
        height: referenceHeight,
        comparisonHeight: h,
        header: h === 961640 ? checkpoint : header,
      });
    } else if (url.endsWith('blocks/tip/height')) body = String(referenceHeight);
    else if (url.endsWith('block-height/961640')) body = 'a'.repeat(64);
    else if (url.endsWith('block/' + 'a'.repeat(64) + '/header')) body = checkpoint;
    else if (url.includes('block-height/')) body = 'b'.repeat(64);
    else body = header;
    return { ok: true, text: async () => body } as Response;
  }) as any;
});

describe('chain reference read isolation', () => {
  it('cross-checks fork and recent headers without wallet identifiers', async () => {
    const result = await checkChain();
    expect(result).toMatchObject({
      state: 'verified',
      source: 'mempool.guide',
      serverLabel: 'Fulcrum',
    });
    expect(requested).toHaveLength(5);
    expect(requested.every(u => !/address|balance|scripthash|transaction|txid/.test(u))).toBe(true);
  });
  it('reports disconnected Electrum without network or popup side effects', async () => {
    (Electrum.createChainFreshnessReader as jest.Mock).mockImplementation(() => {
      throw new Error('offline');
    });
    expect((await checkChain()).state).toBe('unverified');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('allows the selected home reference while public is offline', async () => {
    publicOffline = true;
    home = JSON.stringify({
      url: 'https://home.example/chain',
      host: 'home.example',
      port: '50002',
    });
    expect(await checkChain()).toMatchObject({
      state: 'verified',
      source: 'Knots',
    });
  });
  it('does not reuse a home reference bound to another wallet server', async () => {
    publicOffline = true;
    home = JSON.stringify({
      url: 'https://home.example/chain',
      host: 'other.example',
      port: '50002',
    });
    expect((await checkChain()).state).toBe('unverified');
    expect(requested.some(u => u.startsWith('https://home.example'))).toBe(false);
  });
  it('rejects late results after a provider change', async () => {
    current = false;
    expect((await checkChain()).state).toBe('unverified');
  });
  it('detects the actual 327-block failure and confirms it only on repeat', async () => {
    height = 976710;
    const first = await checkChain();
    expect(first.state).toBe('suspect');
    const second = await checkChain({
      ...first,
      checkedAt: Date.now() - 120000,
    });
    expect(second.state).toBe('behind');
  });
  it('keeps last verified time but never marks failed verification green', async () => {
    publicOffline = true;
    const result = await checkChain({
      state: 'verified',
      serverLabel: 'Fulcrum',
      message: '',
      references: [],
      verifiedAt: 123,
    });
    expect(result.state).toBe('unverified');
    expect(result.verifiedAt).toBe(123);
  });
  it('rejects a public reference on a different fork', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => '977037',
    });
    expect((await checkChain()).state).toBe('unverified');
  });
  it('stores only metadata endpoint plus its selected server association', async () => {
    await setHomeReference('https://home.example/chain');
    expect(DefaultPreference.set).toHaveBeenCalledWith(
      'chain_home_reference_v1',
      JSON.stringify({
        url: 'https://home.example/chain',
        host: 'home.example',
        port: '50002',
      }),
    );
  });
});

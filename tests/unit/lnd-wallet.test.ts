import { NativeModules } from 'react-native';
import { LndWallet, LndOverview } from '../../class/wallets/lnd-wallet';
import WalletGradient from '../../class/wallet-gradient';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';

const overview: LndOverview = {
  node: '02' + 'a'.repeat(64),
  synced: true,
  peers: '1',
  height: '980556',
  activeChannels: '1',
  fundingTotal: '800000',
  fundingConfirmed: '790000',
  fundingPending: '10000',
  fundingLocked: '1000',
  anchorReserve: '2000',
  lightningLocal: '99056',
  lightningRemote: '900000',
  channelPending: '50000',
  splicePending: '30000',
};
const bridge = {
  run: jest.fn(async () => 'Running'),
  wallet: jest.fn(async () => overview),
};
NativeModules.XBTLightningBridge = bridge;
beforeEach(() => {
  bridge.run.mockReset().mockResolvedValue('Running');
  bridge.wallet.mockReset().mockResolvedValue(overview);
});

test('same red palette; count owned funding/local/pending funds without remote liquidity or reserves twice', async () => {
  const wallet = new LndWallet();
  await wallet.fetchBalance();
  expect(wallet.getBalance()).toBe(979056);
  expect(WalletGradient.gradientsFor(wallet.type)).toEqual(WalletGradient.gradientsFor(XbtSegwitBech32Wallet.type));
  expect(wallet.getSecret()).toBe('');
  expect(wallet.getAddress()).toBe(false);
  expect(wallet.allowSend()).toBe(false); // no generic BTC signer route
  expect(wallet.allowReceive()).toBe(false);
});

test('green requires fresh synced RPC evidence and an actual Lightning peer', async () => {
  const wallet = new LndWallet();
  expect(wallet.connection()).toBe('disconnected');
  await wallet.fetchBalance();
  expect(wallet.connection()).toBe('connected');
  expect(wallet.connection(wallet.observedAt + 30001)).toBe('disconnected');
  wallet.overview = { ...overview, peers: '0' };
  expect(wallet.connection()).toBe('checking');
  wallet.overview = { ...overview, synced: false };
  expect(wallet.connection()).toBe('checking');
});

test('restored card retains balances and identity, never a green LED, injected methods, seed or state', async () => {
  const wallet = new LndWallet().setLabel('My LND');
  await wallet.fetchBalance();
  const restored = LndWallet.fromJson(
    JSON.stringify({
      ...wallet,
      secret: 'fake seed',
      getID: 'injected',
      chain: 'ONCHAIN',
    }),
  );
  expect(restored.getID()).toBe(wallet.getID());
  expect(restored.getLabel()).toBe('My LND');
  expect(restored.getBalance()).toBe(979056);
  expect(restored.connection()).toBe('disconnected');
  expect(restored.getSecret()).toBe('');
  expect(restored.secret).toBe('');
  expect(restored.chain).toBe(wallet.chain);
});

test('failed refresh retains last balances and clears connection evidence', async () => {
  const wallet = new LndWallet();
  await wallet.fetchBalance();
  bridge.wallet.mockRejectedValueOnce(new Error('Disconnected'));
  await expect(wallet.fetchBalance()).rejects.toThrow('Disconnected');
  expect(wallet.getBalance()).toBe(979056);
  expect(wallet.connection()).toBe('disconnected');
});

test('stopped and unavailable native nodes never fabricate a balance or a connection', async () => {
  const wallet = new LndWallet();
  bridge.run.mockResolvedValueOnce('Stopped');
  await wallet.fetchBalance();
  expect(bridge.wallet).not.toHaveBeenCalled();
  expect(wallet.getBalance()).toBe(0);
  expect(wallet.connection()).toBe('disconnected');
});

test.each(['-1', '9007199254740992', 'NaN'])('rejects unsafe serialized monetary value %s', value => {
  expect(() => LndWallet.fromJson(JSON.stringify({ overview: { ...overview, lightningLocal: value } }))).toThrow('Invalid LND balance');
});

/**
 * Validate the simulator backend through real wallet discovery, authenticated
 * TLS/HTTPS, signing and broadcast. This is not evidence of native UI completion.
 */
import assert from 'assert';
import https from 'https';
import { verifyPublicFundingSeparation } from '../../class/xbt/separation-service';
import { StandardHardwareNativeFixture, PUBLIC_WATCH_ACCOUNT, PUBLIC_RECIPIENT, EXPLORER_PORT } from '../native/standard-hardware-fixture';

import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
const mockPreferences = new Map<string, string>();
jest.mock('react-native-default-preference', () => ({
  __esModule: true,
  default: {
    setName: jest.fn(),
    get: jest.fn(async (key: string) => mockPreferences.get(key)),
    set: jest.fn(async (key: string, value: string) => {
      mockPreferences.set(key, value);
    }),
    clear: jest.fn(async (key: string) => {
      mockPreferences.delete(key);
    }),
  },
}));
jest.mock('../../class/xbt/standard-hardware', () => ({
  ...jest.requireActual('../../class/xbt/standard-hardware'),
  assertStandardHardwareReleased: jest.fn(),
}));
const real =
  process.env.REDWALLET_BTC_REGTEST_BITCOIND && process.env.REDWALLET_XBT_REGTEST_BITCOIND && process.env.REDWALLET_XBT_REGTEST_FULCRUM
    ? test
    : test.skip;
const originalFetch = global.fetch;
function get(url: string, ca?: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { ca }, response => {
      let text = '';
      response.on('data', part => {
        text += part.toString();
      });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode!, text }));
    });
    request.setTimeout(10000, () => request.destroy(new Error('Fixture HTTPS timeout')));
    request.on('error', reject);
  });
}
real(
  'native fixture discovers coins and submits a verified standard transaction over authenticated transports',
  async () => {
    const fixture = new StandardHardwareNativeFixture();
    try {
      await fixture.start({
        core: process.env.REDWALLET_BTC_REGTEST_BITCOIND!,
        knots: process.env.REDWALLET_XBT_REGTEST_BITCOIND!,
        fulcrum: process.env.REDWALLET_XBT_REGTEST_FULCRUM!,
      });
      await expect(get('https://127.0.0.1:' + EXPLORER_PORT + '/evidence/blocks/tip/height')).rejects.toThrow();
      expect(fixture.explorerRequests).toHaveLength(0);
      // Only this test's HTTP destination is adapted. Production verifier and
      // certificate validation remain enabled; native uses a build-only overlay.
      global.fetch = jest.fn(async (url: any) => {
        const parsed = new URL(url);
        assert(['blockstream.info', 'mempool.space'].includes(parsed.hostname));
        const local =
          'https://127.0.0.1:' +
          EXPLORER_PORT +
          (parsed.hostname === 'blockstream.info' ? '/evidence' : '/anchor') +
          parsed.pathname.slice(4);
        const result = await get(local, fixture.transport.ca);
        return {
          ok: result.status === 200,
          redirected: false,
          url,
          headers: { get: () => null },
          text: async () => result.text,
        } as any;
      });
      const verify = () => verifyPublicFundingSeparation([fixture.funding], () => {});
      await expect(verify()).rejects.toThrow('separation');
      fixture.proof = 'valid';
      await expect(verify()).resolves.toBeUndefined();
      fixture.proof = 'disagreement';
      await expect(verify()).rejects.toThrow('separation');
      fixture.proof = 'unavailable';
      await expect(verify()).rejects.toThrow('separation');
      fixture.proof = 'valid';
      await fixture.reorg(true);
      await expect(verify()).rejects.toThrow('separation');
      await fixture.reorg(false);
      await expect(verify()).resolves.toBeUndefined();

      mockPreferences.set(BlueElectrum.ELECTRUM_HOST, '127.0.0.1');
      mockPreferences.set(BlueElectrum.ELECTRUM_SSL_PORT, String(fixture.transport.port));
      mockPreferences.set(BlueElectrum.ELECTRUM_TLS_CA, fixture.transport.ca);
      mockPreferences.set('electrum_default_server_declined', '1');
      await BlueElectrum.setDisabled(false);
      expect(await BlueElectrum.ensureConnected()).toBe(true);
      const watch = new WatchOnlyWallet();
      watch.setSecret(PUBLIC_WATCH_ACCOUNT);
      // Match the XBT import flow: choose the network before fetching history.
      watch.xbt_network = true;
      watch.init();
      await watch.fetchBalance();
      await watch.fetchTransactions();
      await watch.fetchUtxo();
      expect(watch.getBalance()).toBe(999000);
      expect(watch.getUtxo()).toHaveLength(1);
      // Enabling signing after discovery must preserve verified spendable coins.
      watch.setUseWithHardwareWalletEnabled(true);
      watch.setHardwareSigningMode('standard');
      expect(watch.getUtxo()).toHaveLength(1);
      const { psbt: request } = await watch.createStandardHardwareTransaction(
        watch.getUtxo(),
        [{ address: PUBLIC_RECIPIENT, value: 100000 }],
        2,
        watch._getInternalAddressByIndex(0),
      );
      const signed = fixture.sign(request);
      const hex = watch.combinePsbt(request, signed).toHex();
      await expect(watch.broadcastTx(hex)).resolves.toBe(true);
      expect(fixture.transport.broadcasts).toEqual([hex]);
      const result = await fixture.settle(hex);
      expect(result.confirmations).toBe(2);
      expect(result.btcRejection.allowed).toBe(false);
    } finally {
      global.fetch = originalFetch;
      BlueElectrum.forceDisconnect();
      await BlueElectrum.setDisabled(true);
      await fixture.stop();
      expect(fixture.cleanupComplete).toBe(true);
    }
  },
  240000,
);

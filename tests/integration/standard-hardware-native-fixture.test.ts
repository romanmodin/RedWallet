/**
 * Validate the new simulator backend over authenticated HTTPS before the costly
 * native run. This is a fixture test, not evidence of native UI completion.
 */
import assert from 'assert';
import https from 'https';
import * as bitcoin from 'bitcoinjs-lib';
import { BIP32Factory } from 'bip32';
import ecc from '../../blue_modules/noble_ecc';
import { verifyPublicFundingSeparation } from '../../class/xbt/separation-service';
import { StandardHardwareNativeFixture, PUBLIC_WATCH_ACCOUNT, PUBLIC_RECIPIENT, EXPLORER_PORT } from '../native/standard-hardware-fixture';

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
  'native fixture authenticates HTTPS and supplies fail-closed proof over real competing chains',
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

      const pub = BIP32Factory(ecc).fromBase58(PUBLIC_WATCH_ACCOUNT.split(']')[1]).derivePath('0/0').publicKey;
      const request = new bitcoin.Psbt();
      request.addInput({
        hash: fixture.funding.getId(),
        index: 0,
        nonWitnessUtxo: fixture.funding.toBuffer(),
        witnessUtxo: fixture.funding.outs[0],
        sighashType: 1,
        bip32Derivation: [
          {
            pubkey: pub,
            masterFingerprint: Buffer.from('73c5da0a', 'hex'),
            path: "m/84'/0'/0'/0/0",
          },
        ],
      });
      request.addOutput({ address: PUBLIC_RECIPIENT, value: 100000n });
      request.addOutput({
        script: fixture.funding.outs[0].script,
        value: 898000n,
      });
      const signed = fixture.sign(request);
      expect(signed.validateSignaturesOfAllInputs((key, hash, sig) => ecc.verify(hash, key, sig))).toBe(true);
      signed.finalizeAllInputs();
      const hex = signed.extractTransaction().toHex();
      await fixture.knots.rpc('sendrawtransaction', [hex]);
      const result = await fixture.settle(hex);
      expect(result.confirmations).toBe(2);
      expect(result.btcRejection.allowed).toBe(false);
    } finally {
      global.fetch = originalFetch;
      await fixture.stop();
      expect(fixture.cleanupComplete).toBe(true);
    }
  },
  240000,
);

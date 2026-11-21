import BIP32Factory from 'bip32';
import ecc from '../../blue_modules/noble_ecc';
import { createHardwareSigningFixture } from '../../scripts/diagnostics/hardware-signing-fixture';
import { DisposableNode } from '../helpers/standard-hardware-node';

const core = process.env.REDWALLET_BTC_REGTEST_BITCOIND;
const knots = process.env.REDWALLET_XBT_REGTEST_BITCOIND;
const real = core && knots ? test : test.skip;
real(
  'both isolated consensus engines reject the hardware fixture parent before looking up any funds',
  async () => {
    const master = BIP32Factory(ecc).fromSeed(Buffer.alloc(32, 1));
    const accountPath = "m/84'/0'/0'";
    const account = {
      fingerprint: Buffer.from(master.fingerprint).toString('hex'),
      accountPath,
      xpub: master.derivePath(accountPath).neutered().toBase58(),
    };
    const parents = [createHardwareSigningFixture(account).funding, ...createHardwareSigningFixture(account, 'send').parents];
    for (const [binary, xbt] of [
      [core!, false],
      [knots!, true],
    ] as const) {
      const node = new DisposableNode();
      try {
        await node.start(binary, xbt);
        for (const parent of parents) {
          const result = (await node.rpc('testmempoolaccept', [[parent.toHex()]]))[0];
          expect(result.allowed).toBe(false);
          expect(result['reject-reason']).toMatch(/bad-txns-inputs-duplicate/);
        }
      } finally {
        await node.stop();
      }
    }
  },
  60000,
);

import { CryptoPSBT } from '@keystonehq/bc-ur-registry';
import { URDecoder } from '@ngraveio/bc-ur';
import { Psbt } from 'bitcoinjs-lib';
import { StandardHardwareNativeFixture, PUBLIC_WATCH_ACCOUNT, PUBLIC_RECEIVE_ADDRESS } from './standard-hardware-fixture';

// This import previously crashed only under Detox's separate Jest config.
// Keep this preflight ahead of the expensive simulator build and node setup.
test('native host loads real signing crypto and derives the public BIP84 account', () => {
  expect(PUBLIC_WATCH_ACCOUNT).toMatch(/^\[73c5da0a\/84h\/0h\/0h\]xpub/);
  expect(PUBLIC_RECEIVE_ADDRESS).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  expect(new StandardHardwareNativeFixture().proof).toBe('missing');
});

test('native host produces interoperable multipart PSBT fragments', () => {
  const psbt = new Psbt();
  psbt.addInput({ hash: Buffer.alloc(32, 1), index: 0 });
  psbt.addOutput({ script: Buffer.alloc(22, 2), value: 1n });
  const encoder = new CryptoPSBT(Buffer.from(psbt.toBuffer())).toUREncoder(30);
  expect(encoder.fragmentsLength).toBeGreaterThan(1);
  const parts = Array.from({ length: encoder.fragmentsLength }, () => encoder.nextPart().toUpperCase());
  const decoder = new URDecoder();
  for (const part of parts.reverse()) decoder.receivePart(part);
  expect(decoder.isComplete()).toBe(true);
  expect(decoder.isSuccess()).toBe(true);
  expect(Buffer.from(CryptoPSBT.fromCBOR(decoder.resultUR().cbor).getPSBT())).toEqual(Buffer.from(psbt.toBuffer()));
});

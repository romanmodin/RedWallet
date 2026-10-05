import * as bitcoin from 'bitcoinjs-lib';
import vectors from '../fixtures/native-lifecycle-vectors.json';
import { fixtureAddress, fixtureOutputScript } from '../native/knots-fulcrum-harness';

beforeAll(() => bitcoin.initEccLib(undefined));

for (const format of ['segwit', 'taproot'] as const) {
  test(format + ' driver round-trips public funding scripts without signing ECC', () => {
    for (const address of vectors[format].receive) {
      const script = fixtureOutputScript(address);
      const regtest = fixtureAddress(script, 'bcrt');
      const witness = bitcoin.address.fromBech32(regtest);
      expect(witness.prefix).toBe('bcrt');
      expect(witness.version).toBe(format === 'taproot' ? 1 : 0);
      expect(Buffer.from(witness.data)).toEqual(Buffer.from(script.slice(2)));
      expect(fixtureAddress(script)).toBe(address);
      if (format === 'taproot') expect(fixtureOutputScript(regtest)).toEqual(script);
    }
  });
}

test('driver rejects an invalid Taproot checksum', () => {
  const address = vectors.taproot.receive[0];
  const invalid = address.slice(0, -1) + (address.endsWith('q') ? 'p' : 'q');
  expect(() => fixtureOutputScript(invalid)).toThrow();
});

test('driver rejects non-32-byte v1 witness programs', () => {
  const address = bitcoin.address.toBech32(new Uint8Array(20), 1, 'bc');
  expect(() => fixtureOutputScript(address)).toThrow();
});

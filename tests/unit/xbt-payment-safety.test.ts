import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import ecc from '../../blue_modules/noble_ecc';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import PayjoinTransaction from '../../class/payjoin-transaction';
import { getPayjoinUrl, supportsPayjoin } from '../../class/payjoin-policy';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { assertXbtUnifiedTransaction } from '../../class/xbt/broadcast-validation';
import fixture from '../fixtures/xbt-knots-regtest-acceptance.json';

jest.mock('../../blue_modules/BlueElectrum', () => ({ broadcastV2: jest.fn() }));

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ECPair = ECPairFactory(ecc);

function transactionWithFlag(flag: number, index = 0): string {
  const tx = bitcoin.Transaction.fromHex(fixture.signed.goodHex);
  const signature = tx.ins[index].witness[0];
  signature[signature.length - 1] = flag;
  return tx.toHex();
}

describe('XBT payment safety', () => {
  beforeEach(() => jest.clearAllMocks());

  it('removes a supplied Payjoin endpoint for unsupported wallets, including XBT', () => {
    const url = 'https://payee.example/payjoin';
    const wallet = new XbtSegwitBech32Wallet();
    expect(getPayjoinUrl(wallet, url)).toBe('');
    expect(getPayjoinUrl(undefined, url)).toBe('');
    expect(getPayjoinUrl({ type: 'unsupported', allowPayJoin: () => false }, url)).toBe('');
    // XBT must still be blocked if a capability method is accidentally changed.
    jest.spyOn(wallet, 'allowPayJoin').mockReturnValue(true);
    expect(supportsPayjoin(wallet)).toBe(false);
    expect(getPayjoinUrl(wallet, url)).toBe('');
    expect(getPayjoinUrl({ type: 'supported', allowPayJoin: () => true }, url)).toBe(url);
  });

  it('refuses to construct a Payjoin adapter before looking up keys or calling the endpoint', () => {
    const wallet = new XbtSegwitBech32Wallet();
    const keyLookup = jest.spyOn(wallet, '_getWifForAddress');
    const broadcast = jest.fn();
    expect(() => new PayjoinTransaction(bitcoin.Psbt.fromBase64(fixture.signed.finalizedPsbt), broadcast, wallet)).toThrow(
      'Payjoin is not supported',
    );
    expect(keyLookup).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('reproduces the pinned dependency losing the hash type and re-signing with 0x01', () => {
    const wallet = new XbtSegwitBech32Wallet();
    wallet.setSecret(mnemonic);
    const psbt = bitcoin.Psbt.fromBase64(fixture.signed.finalizedPsbt);
    for (const [index, input] of psbt.data.inputs.entries()) {
      expect(input.sighashType).toBeUndefined();
      delete input.finalScriptWitness;
      const address = bitcoin.address.fromOutputScript(input.witnessUtxo!.script);
      psbt.signInput(index, ECPair.fromWIF(wallet._getWifForAddress(address))).finalizeInput(index);
    }
    const unsafe = psbt.extractTransaction(true);
    expect(unsafe.ins.every(input => input.witness[0].at(-1) === 0x01)).toBe(true);
    expect(() => assertXbtUnifiedTransaction(unsafe.toHex())).toThrow('without SIGHASH_ALL');
  });

  it('allows the recorded valid two-input Unified payment through the wallet broadcast boundary', async () => {
    const wallet = new XbtSegwitBech32Wallet();
    const broadcast = jest.mocked(BlueElectrum.broadcastV2).mockResolvedValue('a'.repeat(64));
    expect(() => assertXbtUnifiedTransaction(fixture.signed.goodHex)).not.toThrow();
    await expect(wallet.broadcastTx(fixture.signed.goodHex)).resolves.toBe(true);
    expect(broadcast).toHaveBeenCalledWith(fixture.signed.goodHex);
  });

  it.each([0x01, 0x00, 0x20, 0x22, 0x23, 0x81, 0xa1])('blocks hash type 0x%s on every input before network access', async flag => {
    const wallet = new XbtSegwitBech32Wallet();
    for (const index of [0, 1]) {
      await expect(wallet.broadcastTx(transactionWithFlag(flag, index))).rejects.toThrow('without SIGHASH_ALL');
    }
    expect(BlueElectrum.broadcastV2).not.toHaveBeenCalled();
  });

  it('blocks missing witnesses, malformed signatures, legacy scripts and malformed transactions', async () => {
    const mutations = [
      (tx: bitcoin.Transaction) => (tx.ins[1].witness = []),
      (tx: bitcoin.Transaction) => (tx.ins[0].witness[0] = Uint8Array.from([0x30, 0x21])),
      (tx: bitcoin.Transaction) => (tx.ins[0].script = Uint8Array.from([0x01])),
      (tx: bitcoin.Transaction) => (tx.ins[0].witness[1] = Uint8Array.from([0x02])),
    ];
    const wallet = new XbtSegwitBech32Wallet();
    for (const mutate of mutations) {
      const tx = bitcoin.Transaction.fromHex(fixture.signed.goodHex);
      mutate(tx);
      await expect(wallet.broadcastTx(tx.toHex())).rejects.toThrow();
    }
    await expect(wallet.broadcastTx('not a transaction')).rejects.toThrow();
    expect(BlueElectrum.broadcastV2).not.toHaveBeenCalled();
  });
});

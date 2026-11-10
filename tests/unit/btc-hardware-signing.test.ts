import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import ecc from '../../blue_modules/noble_ecc';
import { BtcWatchOnlyWallet } from '../../class/wallets/btc-watch-only-wallet';
import { BtcSegwitBech32Wallet } from '../../class/wallets/btc-segwit-bech32-wallet';
import { BlueURDecoder, encodeUR, setUseURv1, clearUseURv1 } from '../../blue_modules/ur';
import { BlueApp } from '../../class/blue-app';
import { assertXbtUnifiedTransaction } from '../../class/xbt/broadcast-validation';

jest.mock('electrum-client', () => jest.fn());
const keyPair = ECPairFactory(ecc);
const seed = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const recipient = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';

function fixture(fingerprint = '73c5da0a') {
  const signer = new BtcSegwitBech32Wallet();
  signer.setSecret(seed);
  const wallet = new BtcWatchOnlyWallet();
  wallet
    .setSecret(
      JSON.stringify({
        xpub: signer.getXpub(),
        path: "m/84'/0'/0'",
        xfp: fingerprint,
      }),
    )
    .init();
  const utxos = [0, 1].map(index => {
    const address = wallet._getExternalAddressByIndex(index);
    const raw = new bitcoin.Transaction();
    raw.addInput(Buffer.alloc(32, index + 1), 0);
    raw.addOutput(bitcoin.address.toOutputScript(address), 60_000n);
    return {
      txid: raw.getId(),
      vout: 0,
      value: 60_000,
      address,
      confirmations: 120,
      rawHex: raw.toHex(),
    };
  });
  jest.spyOn(wallet._hdWalletInstance!, 'getTransactions').mockReturnValue(
    utxos.map(u => ({
      txid: u.txid,
      rawHex: u.rawHex,
      confirmations: u.confirmations,
    })) as any,
  );
  const change = wallet._getInternalAddressByIndex(0);
  const create = () => wallet.createTransaction(utxos, [{ address: recipient, value: 80_000 }], 2, change);
  const sign = (psbt: bitcoin.Psbt) => {
    const returned = psbt.clone();
    returned.txInputs.forEach((input, index) => {
      const txid = Buffer.from(input.hash).reverse().toString('hex');
      const address = utxos.find(u => u.txid === txid)!.address;
      returned.signInput(index, keyPair.fromWIF(signer._getWifForAddress(address)!));
    });
    return returned;
  };
  return { wallet, signer, utxos, change, create, sign };
}

test('requires explicit BTC opt-in; retains public-only keys and standard sighash metadata', () => {
  const { wallet, create } = fixture('ab000000');
  expect(create).toThrow('Enable BTC hardware signing');
  wallet.setUseWithHardwareWalletEnabled(true);
  const { psbt, tx } = create();
  expect(tx).toBeUndefined();
  expect(psbt.txInputs).toHaveLength(2);
  for (const input of psbt.data.inputs) {
    expect(input.sighashType).toBe(bitcoin.Transaction.SIGHASH_ALL);
    expect(Buffer.from(input.bip32Derivation![0].masterFingerprint).toString('hex')).toBe('ab000000');
    expect(input.bip32Derivation![0].path).toMatch(/^m\/84'\/0'\/0'\/0\/[01]$/);
  }
  expect(Buffer.from(psbt.data.outputs[1].bip32Derivation![0].masterFingerprint).toString('hex')).toBe('ab000000');
  expect(wallet.getSigningReview(psbt)).toContain(recipient);
  expect(wallet.getSigningReview(psbt)).toContain('Network fee:');
  expect(wallet.getSecret()).not.toContain(seed);
  expect(wallet.xbt_network).toBe(false);
  expect(wallet.isXbtSigningCompatible()).toBe(false);
});

test.each([false, true])('verifies returned %s-finalized signed PSBT and uses only BTC broadcast', async finalized => {
  const { wallet, create, sign } = fixture();
  wallet.setUseWithHardwareWalletEnabled(true);
  const { psbt } = create();
  const returned = sign(psbt);
  if (finalized) returned.finalizeAllInputs();
  const decoder = new BlueURDecoder();
  const parts = encodeUR(returned.toHex(), 80, null);
  for (const part of [...parts].reverse()) decoder.receivePart(part.toUpperCase());
  expect(decoder.isComplete()).toBe(true);
  const imported = bitcoin.Psbt.fromBase64(decoder.toString());
  const tx = wallet.combinePsbt(psbt, imported);
  expect(() => assertXbtUnifiedTransaction(tx.toHex())).toThrow();
  const broadcast = jest.spyOn(wallet._hdWalletInstance!, 'broadcastTx').mockResolvedValue(true);
  expect(await wallet.broadcastTx(tx.toHex())).toBe(true);
  expect(broadcast).toHaveBeenCalledWith(tx.toHex());
});

test.each(['recipient', 'amount', 'sequence', 'locktime', 'input'])('rejects modified %s even if freshly signed', modification => {
  const { wallet, create, sign } = fixture();
  wallet.setUseWithHardwareWalletEnabled(true);
  const { psbt } = create();
  const returned = sign(psbt).finalizeAllInputs().extractTransaction();
  if (modification === 'recipient') returned.outs[0].script = returned.outs[1].script;
  if (modification === 'amount') returned.outs[0].value -= 1n;
  if (modification === 'sequence') returned.ins[0].sequence -= 1;
  if (modification === 'locktime') returned.locktime = 1;
  if (modification === 'input') returned.ins[0].index += 1;
  expect(() => wallet.acceptSignedTransaction(returned.toHex(), psbt)).toThrow('changed the reviewed');
});

test.each(['signature', 'sighash', 'key', 'missing'])('rejects invalid %s in finalized transaction', modification => {
  const { wallet, create, sign } = fixture();
  wallet.setUseWithHardwareWalletEnabled(true);
  const { psbt } = create();
  const tx = sign(psbt).finalizeAllInputs().extractTransaction();
  if (modification === 'signature') tx.ins[0].witness[0][10] = tx.ins[0].witness[0][10] === 1 ? 2 : 1;
  if (modification === 'sighash') tx.ins[0].witness[0][tx.ins[0].witness[0].length - 1] = 0x21;
  if (modification === 'key') tx.ins[0].witness[1] = tx.ins[1].witness[1];
  if (modification === 'missing') tx.ins[1].witness = [];
  expect(() => wallet.acceptSignedTransaction(tx.toHex(), psbt)).toThrow();
});

test('blocks unverified, superseded, disabled, and reloaded requests without broadcasting', async () => {
  const { wallet, create, sign } = fixture();
  wallet.setUseWithHardwareWalletEnabled(true);
  const { psbt } = create();
  const tx = sign(psbt).finalizeAllInputs().extractTransaction();
  const broadcast = jest.spyOn(wallet._hdWalletInstance!, 'broadcastTx').mockResolvedValue(true);
  await expect(wallet.broadcastTx(tx.toHex())).rejects.toThrow('verified signing request');
  const second = wallet.createTransaction(
    fixture().utxos,
    [{ address: recipient, value: 81_000 }],
    3,
    wallet._getInternalAddressByIndex(0),
  );
  expect(() => wallet.combinePsbt(psbt, sign(psbt))).toThrow('no longer current');
  wallet.combinePsbt(second.psbt, sign(second.psbt));
  wallet.setUseWithHardwareWalletEnabled(false);
  await expect(wallet.broadcastTx(tx.toHex())).rejects.toThrow();
  wallet.setUseWithHardwareWalletEnabled(true);
  const fresh = create().psbt;
  const app = new BlueApp();
  app.wallets = [wallet];
  await app.saveToDisk();
  const restored = new BlueApp();
  expect(await restored.loadFromDisk()).toBe(true);
  const reloaded = restored.wallets[0] as BtcWatchOnlyWallet;
  expect(reloaded.allowSend()).toBe(true);
  expect(() => reloaded.combinePsbt(fresh, sign(fresh))).toThrow('no longer current');
  expect(broadcast).not.toHaveBeenCalled();
});

test('Keystone QR explicitly uses crypto-psbt v2 even when a legacy QR preference was saved', async () => {
  const { wallet, create } = fixture();
  wallet.setUseWithHardwareWalletEnabled(true);
  const { psbt } = create();
  try {
    await setUseURv1();
    const parts = encodeUR(psbt.toHex(), 80, null, 'URv2');
    expect(parts.every(part => part.toLowerCase().startsWith('ur:crypto-psbt/'))).toBe(true);
    const decoder = new BlueURDecoder();
    for (const part of parts) decoder.receivePart(part);
    expect(decoder.isComplete()).toBe(true);
    expect(decoder.toString()).toBe(psbt.toBase64());
  } finally {
    await clearUseURv1();
  }
});

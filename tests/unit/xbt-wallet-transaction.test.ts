import * as bitcoin from 'bitcoinjs-lib';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { HDSegwitBech32Transaction } from '../../class/hd-segwit-bech32-transaction';
import { TransactionInputReference } from '../../class/xbt/coinbase-maturity';
import ecc from 'tiny-secp256k1';

import { unifiedSegwitV0SighashAll } from '../../class/xbt/unified-sighash';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import knotsAcceptance from '../fixtures/xbt-knots-regtest-acceptance.json';

jest.mock('../../blue_modules/BlueElectrum', () => ({
  multiGetTransactionByTxid: jest.fn(),
}));

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const coinbaseTxid = '0'.repeat(64);
const ordinaryTxid = '11'.repeat(64);
const fundingTxid = '0123456789abcdef'.repeat(4);

function derSignatureToCompact(signature: Buffer): Buffer {
  const rLength = signature[3];
  const rStart = 4;
  const sLengthOffset = rStart + rLength + 1;
  const sLength = signature[sLengthOffset];
  const r = signature.subarray(rStart, rStart + rLength);
  const s = signature.subarray(sLengthOffset + 1, sLengthOffset + 1 + sLength);
  const compact = Buffer.alloc(64);
  r.copy(compact, 32 - Math.min(r.length, 32), Math.max(0, r.length - 32));
  s.copy(compact, 64 - Math.min(s.length, 32), Math.max(0, s.length - 32));
  return compact;
}

describe('XBT wallet transaction flow', () => {
  function createWalletWithParent(inputs: TransactionInputReference[], confirmations: number) {
    const wallet = new XbtSegwitBech32Wallet();
    wallet.setSecret(mnemonic);
    jest.spyOn(wallet, 'getTransactions').mockReturnValue([{ txid: fundingTxid, inputs, confirmations } as any]);
    return wallet;
  }

  it('builds and signs a wallet transaction with Unified Sighash', () => {
    const wallet = createWalletWithParent([{ txid: ordinaryTxid, vout: 0 }], 100);
    const sourceAddress = wallet._getExternalAddressByIndex(0);
    const destinationAddress = wallet._getExternalAddressByIndex(1);
    const changeAddress = wallet._getInternalAddressByIndex(0);

    const { tx, psbt } = wallet.createTransaction(
      [{ txid: fundingTxid, vout: 0, address: sourceAddress, value: 100_000, confirmations: 100 }],
      [{ address: destinationAddress, value: 50_000 }],
      1,
      changeAddress,
    );

    expect(tx).toBeDefined();
    const decoded = bitcoin.Transaction.fromHex(tx!.toHex());
    expect(decoded.ins).toHaveLength(1);
    expect(Buffer.from(decoded.ins[0].hash)).toEqual(Buffer.from(fundingTxid, 'hex').reverse());
    expect(decoded.ins[0].witness).toHaveLength(2);
    expect(decoded.ins[0].witness[0][decoded.ins[0].witness[0].length - 1]).toBe(0x21);
    expect(decoded.ins[0].witness[1]).toHaveLength(33);
    expect(psbt.data.inputs[0].finalScriptWitness).toBeDefined();

    const publicKey = decoded.ins[0].witness[1];
    const previousOutputScript = Buffer.from(bitcoin.address.toOutputScript(sourceAddress));
    const scriptCode = Buffer.from(bitcoin.payments.p2pkh({ hash: bitcoin.crypto.hash160(publicKey) }).output!);
    const digest = unifiedSegwitV0SighashAll(decoded, 0, [{ value: 100_000n, script: previousOutputScript }], scriptCode);
    const witnessSignature = decoded.ins[0].witness[0];
    expect(witnessSignature[witnessSignature.length - 1]).toBe(0x21);
    expect(ecc.verify(digest, publicKey, derSignatureToCompact(Buffer.from(witnessSignature.subarray(0, -1))))).toBe(true);

    const destinationScript = Buffer.from(bitcoin.address.toOutputScript(destinationAddress));
    expect(decoded.outs.some(output => Buffer.from(output.script).equals(destinationScript))).toBe(true);
  });

  it('reproduces the two-input transaction accepted and mined by Knots in the recorded regtest fixture', () => {
    // Offline golden vector: CI replays production signing, without contacting a node.
    const wallet = new XbtSegwitBech32Wallet();
    wallet.setSecret(mnemonic);
    const parents = knotsAcceptance.fixture.fundingTransactions.map(funding => ({
      transaction: bitcoin.Transaction.fromHex(funding.rawTx),
      confirmations: funding.confirmations,
    }));
    const parentById = new Map(parents.map(parent => [parent.transaction.getId(), parent]));
    const utxos = knotsAcceptance.signed.inputs.map(input => {
      const parent = parentById.get(input.txid)!;
      expect(parent).toBeDefined();
      const output = parent.transaction.outs[input.vout];
      expect(output.value).toBe(BigInt(input.value));
      expect(Buffer.from(output.script)).toEqual(Buffer.from(bitcoin.address.toOutputScript(input.address)));
      return { ...input, value: Number(output.value), confirmations: parent.confirmations };
    });
    const parentSpy = jest.spyOn(wallet, 'getTransactions').mockReturnValue(
      parents.map(({ transaction, confirmations }) => ({
        txid: transaction.getId(),
        confirmations,
        inputs: transaction.ins.map(input => ({
          txid: Buffer.from(input.hash).reverse().toString('hex'),
          vout: input.index,
        })),
      })) as any,
    );
    try {
      const { tx, fee } = wallet.createTransaction(
        utxos,
        [{ address: wallet._getExternalAddressByIndex(2), value: knotsAcceptance.signed.destination.value }],
        knotsAcceptance.signed.feeRateSatPerVbyte,
        wallet._getInternalAddressByIndex(0),
      );
      expect(tx).toBeDefined();
      expect(tx!.toHex()).toBe(knotsAcceptance.signed.goodHex);
      expect(tx!.getId()).toBe(knotsAcceptance.node.confirmation.txid);
      expect(fee).toBe(knotsAcceptance.node.feeSats);
      expect(tx!.ins).toHaveLength(2);
      for (const input of tx!.ins) {
        expect(input.witness).toHaveLength(2);
        expect(input.witness[0][input.witness[0].length - 1]).toBe(0x21);
      }
    } finally {
      parentSpy.mockRestore();
    }
  });

  it('rejects the Knots-accepted signatures under Bitcoin BIP143, including a stripped Unified flag', () => {
    const tx = bitcoin.Transaction.fromHex(knotsAcceptance.signed.goodHex);
    const parents = new Map(
      knotsAcceptance.fixture.fundingTransactions.map(funding => {
        const parent = bitcoin.Transaction.fromHex(funding.rawTx);
        return [parent.getId(), parent];
      }),
    );
    const spentOutputs = tx.ins.map(input => {
      const parent = parents.get(Buffer.from(input.hash).reverse().toString('hex'))!;
      expect(parent).toBeDefined();
      return parent.outs[input.index];
    });
    tx.ins.forEach((input, index) => {
      const [signature, publicKey] = input.witness;
      expect(signature[signature.length - 1]).toBe(0x21);
      const compact = derSignatureToCompact(Buffer.from(signature.subarray(0, -1)));
      const scriptCode = bitcoin.payments.p2pkh({ hash: bitcoin.crypto.hash160(publicKey) }).output!;
      const unifiedDigest = unifiedSegwitV0SighashAll(tx, index, spentOutputs, scriptCode);
      expect(ecc.verify(unifiedDigest, publicKey, compact)).toBe(true);
      // bitcoinjs-lib's independent BIP143 digest, not the custom Unified implementation.
      // Check the actual 0x21 byte as well as an attacker changing it to SIGHASH_ALL.
      for (const hashType of [0x21, bitcoin.Transaction.SIGHASH_ALL]) {
        const bitcoinDigest = tx.hashForWitnessV0(index, scriptCode, spentOutputs[index].value, hashType);
        expect(Buffer.from(bitcoinDigest).equals(unifiedDigest)).toBe(false);
        expect(ecc.verify(bitcoinDigest, publicKey, compact)).toBe(false);
      }
    });
  });

  it('refuses to sign when the input parent is not available to verify coinbase status', () => {
    const wallet = createWalletWithParent([{ txid: ordinaryTxid, vout: 0 }], 100);
    jest.spyOn(wallet, 'getTransactions').mockReturnValue([]);

    expect(() =>
      wallet.createTransaction(
        [{ txid: fundingTxid, vout: 0, address: wallet._getExternalAddressByIndex(0), value: 100_000, confirmations: 100 }],
        [{ address: wallet._getExternalAddressByIndex(1), value: 50_000 }],
        1,
        wallet._getInternalAddressByIndex(0),
      ),
    ).toThrow('Cannot verify XBT input transaction and coinbase maturity');
  });

  it('declares Unified Sighash on every exported unsigned PSBT input and survives serialization', () => {
    const wallet = createWalletWithParent([{ txid: ordinaryTxid, vout: 0 }], 100);
    const { psbt, tx } = wallet.createTransaction(
      [0, 1].map(vout => ({
        txid: fundingTxid,
        vout,
        address: wallet._getExternalAddressByIndex(0),
        value: 60_000,
        confirmations: 100,
      })),
      [{ address: wallet._getExternalAddressByIndex(1), value: 100_000 }],
      1,
      wallet._getInternalAddressByIndex(0),
      undefined,
      true,
    );
    expect(tx).toBeUndefined();
    const restored = bitcoin.Psbt.fromBase64(psbt.toBase64());
    expect(restored.data.inputs).toHaveLength(2);
    expect(restored.data.inputs.every(input => input.sighashType === 0x21 && !input.partialSig)).toBe(true);
  });

  it.each([0, 100, 6479])('filters and refuses verbose coinbase rewards at %i confirmations', confirmations => {
    const wallet = createWalletWithParent([{ coinbase: '03e8ab0e' }], confirmations);
    const utxo = {
      txid: fundingTxid,
      vout: 0,
      address: wallet._getExternalAddressByIndex(0),
      value: 100_000,
      confirmations,
    };
    wallet._utxo = [utxo];
    expect(wallet.getUtxo()).toEqual([]);
    expect(() =>
      wallet.createTransaction(
        [utxo],
        [{ address: wallet._getExternalAddressByIndex(1), value: 50_000 }],
        1,
        wallet._getInternalAddressByIndex(0),
      ),
    ).toThrow('XBT coinbase outputs require 6480 confirmations');
  });

  it('signs a mature verbose coinbase reward with Unified Sighash', () => {
    const wallet = createWalletWithParent([{ coinbase: '03e8ab0e' }], 6480);
    const { tx } = wallet.createTransaction(
      [
        {
          txid: fundingTxid,
          vout: 0,
          address: wallet._getExternalAddressByIndex(0),
          value: 100_000,
          confirmations: 6480,
        },
      ],
      [{ address: wallet._getExternalAddressByIndex(1), value: 50_000 }],
      1,
      wallet._getInternalAddressByIndex(0),
    );
    expect(tx!.ins[0].witness[0].at(-1)).toBe(0x21);
  });

  it.each(['bump', 'cancel', 'cpfp'])('fee %s dispatches through the XBT signer with 0x21 signatures', async action => {
    const wallet = createWalletWithParent([{ txid: ordinaryTxid, vout: 0 }], 100);
    const recipient = new XbtSegwitBech32Wallet();
    recipient.setSecret(mnemonic);
    recipient.setPassphrase('recipient');
    const destination = recipient._getExternalAddressByIndex(0);
    const source = wallet._getExternalAddressByIndex(0);
    const change = wallet._getInternalAddressByIndex(0);
    jest.spyOn(wallet, 'getChangeAddressAsync').mockResolvedValue(change);
    const utxo = {
      txid: fundingTxid,
      vout: 0,
      address: source,
      value: 100_000,
      confirmations: 100,
    };
    const original = wallet.createTransaction([utxo], [{ address: destination, value: 50_000 }], 1, change, 0xfffffffd).tx!;
    const parent = {
      txid: fundingTxid,
      inputs: [{ txid: ordinaryTxid, vout: 0 }],
      confirmations: 100,
    };
    jest
      .spyOn(wallet, 'getTransactions')
      .mockReturnValue([parent, { txid: original.getId(), inputs: parent.inputs, confirmations: 0 }] as any);
    const remote = {
      confirmations: 0,
      vout: original.outs.map((output, n) => ({
        n,
        value: Number(output.value) / 1e8,
        scriptPubKey: {
          address: bitcoin.address.fromOutputScript(output.script),
        },
      })),
    };
    (BlueElectrum.multiGetTransactionByTxid as jest.Mock).mockImplementation(async (txids: string[]) =>
      Object.fromEntries(
        txids.map(txid => [
          txid,
          txid === fundingTxid
            ? {
                vout: [{ value: 0.001, scriptPubKey: { address: source } }],
              }
            : remote,
        ]),
      ),
    );
    const helper = new HDSegwitBech32Transaction(original.toHex(), null, wallet);
    expect(await helper.isSequenceReplaceable()).toBe(true);
    const replacement =
      action === 'bump'
        ? await helper.createRBFbumpFee(3)
        : action === 'cancel'
          ? await helper.createRBFcancelTx(3)
          : await helper.createCPFPbumpFee(5);
    expect(replacement.tx!.getId()).not.toBe(original.getId());
    const spentOutputs = replacement.tx!.ins.map(input => {
      const txid = Buffer.from(input.hash).reverse().toString('hex');
      if (txid === fundingTxid) return { value: 100_000n, script: bitcoin.address.toOutputScript(source) };
      expect(txid).toBe(original.getId());
      return original.outs[input.index];
    });
    replacement.tx!.ins.forEach((input, index) => {
      const [signature, publicKey] = input.witness;
      expect(signature.at(-1)).toBe(0x21);
      const scriptCode = bitcoin.payments.p2pkh({ hash: bitcoin.crypto.hash160(publicKey) }).output!;
      const digest = unifiedSegwitV0SighashAll(replacement.tx!, index, spentOutputs, scriptCode);
      expect(ecc.verify(digest, publicKey, derSignatureToCompact(Buffer.from(signature.subarray(0, -1))))).toBe(true);
    });
    if (action === 'bump')
      expect(
        replacement.tx!.outs.some(
          output => output.value === 50_000n && Buffer.from(output.script).equals(Buffer.from(bitcoin.address.toOutputScript(destination))),
        ),
      ).toBe(true);
    expect(replacement.tx!.ins.every(input => input.sequence < 0xfffffffe)).toBe(true);
    if (action !== 'cpfp')
      expect(replacement.fee).toBeGreaterThan(100_000 - original.outs.reduce((sum, output) => sum + Number(output.value), 0));
  });

  it('refuses to sign an immature coinbase input', () => {
    const wallet = createWalletWithParent([{ txid: coinbaseTxid, vout: 0xffffffff }], 6479);

    expect(() =>
      wallet.createTransaction(
        [{ txid: fundingTxid, vout: 0, address: wallet._getExternalAddressByIndex(0), value: 100_000, confirmations: 6479 }],
        [{ address: wallet._getExternalAddressByIndex(1), value: 50_000 }],
        1,
        wallet._getInternalAddressByIndex(0),
      ),
    ).toThrow('XBT coinbase outputs require 6480 confirmations before spending');
  });
});

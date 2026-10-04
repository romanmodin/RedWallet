import { ECPairFactory } from 'ecpair';

import ecc from '../../blue_modules/noble_ecc';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { isMatureXbtCoinbase, verifiedCoinbaseConfirmations } from '../xbt/coinbase-maturity';
import { SIGHASH_ALL_UNIFIED } from '../xbt/unified-psbt';
import { assertUnifiedTaprootSignatures, finalizeUnifiedTaprootInput, signUnifiedTaprootInput } from '../xbt/unified-taproot-psbt';
import { AbstractHDElectrumWallet } from './abstract-hd-electrum-wallet';
import { HDTaprootWallet } from './hd-taproot-wallet';
import { assertXbtUnifiedTransaction } from '../xbt/broadcast-validation';
import { parseVerifiedParentTransaction } from '../xbt/verified-transaction';
import * as bitcoin from 'bitcoinjs-lib';
import { CreateTransactionResult, CreateTransactionUtxo } from './types';

const ECPair = ECPairFactory(ecc);

/** XBT BIP86 key-path wallet; its transaction signatures use Knots Unified Sighash. */
export class XbtTaprootWallet extends HDTaprootWallet {
  static readonly type = 'HDtaprootXBT';
  static readonly typeReadable = 'XBT Taproot (BIP86)';
  // @ts-ignore: override
  public readonly type = XbtTaprootWallet.type;
  // @ts-ignore: override
  public readonly typeReadable = XbtTaprootWallet.typeReadable;
  public readonly segwitType = 'p2tr';
  static readonly derivationPath = "m/86'/0'/0'";

  allowRBF() {
    return true;
  }

  allowPayJoin() {
    return false;
  }

  requiresVerifiedTransactions() {
    return true;
  }

  async broadcastTx(txhex: string): Promise<boolean> {
    assertXbtUnifiedTransaction(txhex);
    return super.broadcastTx(txhex);
  }

  allowCosignPsbt() {
    return false;
  }

  allowBIP47() {
    return false;
  }

  allowSilentPaymentSend() {
    return false;
  }

  /** Refresh coinbase maturity from matching history/UTXO heights at one observed tip. */
  async fetchUtxo(): Promise<void> {
    await super.fetchUtxo();
    const parents = new Map(this.getTransactions().map(transaction => [transaction.txid, transaction]));
    const coinbases = this._utxo.filter(utxo => {
      const parent = parents.get(utxo.txid);
      if (!parent?.rawHex) return false;
      try {
        return parseVerifiedParentTransaction(utxo.txid, parent.rawHex).isCoinbase();
      } catch {
        return false;
      }
    });
    if (!coinbases.length) return;
    // A failed refresh cannot leave an old mature count usable with contradictory new data.
    for (const utxo of coinbases) {
      parents.get(utxo.txid)!.confirmations = 0;
      utxo.confirmations = 0;
    }
    const histories = await BlueElectrum.multiGetHistoryByAddress([...new Set(coinbases.map(utxo => utxo.address))]);
    const tip = await BlueElectrum.getReportedBlockTip();
    const heights = new Map<string, Set<number>>();
    for (const history of Object.values(histories)) {
      for (const item of history) {
        const found = heights.get(item.tx_hash) || new Set<number>();
        found.add(item.height);
        heights.set(item.tx_hash, found);
      }
    }
    for (const utxo of coinbases) {
      const reported = heights.get(utxo.txid);
      const height = reported?.size === 1 ? [...reported][0] : undefined;
      if (tip === null || height === undefined || !Number.isSafeInteger(height) || height <= 0 || height > tip || utxo.height !== height)
        continue;
      const confirmations = tip - height + 1;
      if (!Number.isSafeInteger(confirmations)) continue;
      parents.get(utxo.txid)!.confirmations = confirmations;
      utxo.confirmations = confirmations;
    }
  }

  getUtxo(respectFrozen = false) {
    const transactions = new Map(this.getTransactions().map(transaction => [transaction.txid, transaction]));
    return super.getUtxo(respectFrozen).flatMap(utxo => {
      const parent = transactions.get(utxo.txid);
      if (!parent?.rawHex) return [];
      let raw;
      try {
        raw = parseVerifiedParentTransaction(utxo.txid, parent.rawHex);
      } catch {
        return [];
      }
      const output = raw.outs[utxo.vout];
      if (
        !output ||
        output.value !== BigInt(utxo.value) ||
        Buffer.compare(Buffer.from(output.script), Buffer.from(bitcoin.address.toOutputScript(utxo.address))) !== 0
      )
        return [];
      const coinbase = raw.isCoinbase();
      let confirmations;
      try {
        confirmations = coinbase
          ? verifiedCoinbaseConfirmations(utxo.confirmations, parent.confirmations)
          : (utxo.confirmations ?? parent.confirmations);
      } catch {
        return [];
      }
      if (coinbase && !isMatureXbtCoinbase(confirmations)) return [];
      return [{ ...utxo, coinbase, confirmations }];
    });
  }

  coinselect(...args: Parameters<AbstractHDElectrumWallet['coinselect']>) {
    const [utxos, targets, feeRate] = args;
    const result = super.coinselect(utxos, targets, feeRate);
    const outputs = result.outputs as ((typeof result.outputs)[number] & {
      script?: { hex?: string };
    })[];
    // coinselect assumes 25-byte change. BIP86 change is 34 bytes; price
    // the actual 65-byte Unified witness and CompactSize lengths instead.
    const estimate = new bitcoin.Transaction();
    result.inputs.forEach((_, index) => {
      estimate.addInput(Buffer.alloc(32), index);
      estimate.setWitness(index, [Buffer.alloc(65)]);
    });
    outputs.forEach(output => {
      const script = output.address
        ? bitcoin.address.toOutputScript(output.address)
        : output.script?.hex
          ? Buffer.from(output.script.hex, 'hex')
          : Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32)]);
      estimate.addOutput(script, BigInt(output.value));
    });
    const additionalFee = Math.ceil(estimate.virtualSize() * feeRate) - result.fee;
    const change = outputs.find(output => !output.address && !output.script?.hex);
    if (additionalFee > 0) {
      const adjustable =
        change ?? outputs.find(output => targets.some(target => target.address === output.address && target.value === undefined));
      if (!adjustable || adjustable.value <= additionalFee) throw new Error('Not enough balance for the Taproot transaction fee');
      adjustable.value -= additionalFee;
      result.fee += additionalFee;
    }
    // Do not leave change below the standard P2TR dust threshold after pricing its actual size.
    if (change && change.value < 330) {
      result.outputs = outputs.filter(output => output !== change);
      result.fee += change.value;
    }
    return result;
  }

  createTransaction(...args: Parameters<AbstractHDElectrumWallet['createTransaction']>) {
    const [utxos, targets, feeRate, changeAddress, sequence, skipSigning, masterFingerprint] = args;
    if (!this.weOwnAddress(changeAddress)) throw new Error('XBT change address is not controlled by this wallet');
    const verifiedUtxos = this.verifyInputs(utxos);
    const result = super.createTransaction(verifiedUtxos, targets, feeRate, changeAddress, sequence, true, masterFingerprint);
    result.psbt.data.inputs.forEach((_, inputIndex) => {
      result.psbt.updateInput(inputIndex, { sighashType: SIGHASH_ALL_UNIFIED });
      const fingerprint = Buffer.alloc(4);
      fingerprint.writeUInt32LE(masterFingerprint ?? 0);
      result.psbt.data.inputs[inputIndex].tapBip32Derivation?.forEach(derivation => {
        derivation.masterFingerprint = fingerprint;
      });
    });
    this.addOwnedOutputMetadata(result.psbt, masterFingerprint ?? 0);
    if (skipSigning) return result;
    return this.signTransaction(result);
  }

  private signTransaction(result: CreateTransactionResult): CreateTransactionResult {
    result.inputs.forEach((input, inputIndex) => {
      if (!input.address) throw new Error('XBT signing input is missing its wallet address');
      const wif = this._getWifForAddress(input.address);
      if (!wif) throw new Error('XBT signing input is not controlled by this wallet');
      const internalKey = result.psbt.data.inputs[inputIndex].tapInternalKey;
      if (!internalKey) throw new Error('XBT Taproot input is missing its internal key');
      const keyPair = ECPair.fromWIF(wif).tweak(bitcoin.crypto.taggedHash('TapTweak', internalKey));
      if (!keyPair.signSchnorr || !ecc.verifySchnorr) throw new Error('Schnorr signing is unavailable');
      const signSchnorr = keyPair.signSchnorr.bind(keyPair);
      const verifySchnorr = ecc.verifySchnorr;
      const outputKey = keyPair.publicKey.subarray(1);
      signUnifiedTaprootInput(result.psbt, inputIndex, {
        publicKey: outputKey,
        sign: messageHash => signSchnorr(messageHash),
      });
      finalizeUnifiedTaprootInput(result.psbt, inputIndex, (publicKey, messageHash, signature) =>
        verifySchnorr(messageHash, publicKey, signature),
      );
    });

    result.tx = result.psbt.extractTransaction();
    return result;
  }

  private verifyInputs(utxos: CreateTransactionUtxo[]) {
    const transactions = new Map(this.getTransactions().map(transaction => [transaction.txid, transaction]));
    return utxos.map(utxo => {
      const parent = transactions.get(utxo.txid);
      if (!parent?.rawHex) throw new Error('Cannot verify XBT input transaction and coinbase maturity; refresh wallet history');
      const raw = parseVerifiedParentTransaction(utxo.txid, parent.rawHex);
      const output = raw.outs[utxo.vout];
      if (
        !Number.isSafeInteger(utxo.value) ||
        !output ||
        output.value !== BigInt(utxo.value) ||
        !utxo.address ||
        Buffer.compare(Buffer.from(output.script), Buffer.from(bitcoin.address.toOutputScript(utxo.address))) !== 0
      ) {
        throw new Error('XBT input amount or address does not match its raw parent transaction');
      }
      const coinbase = raw.isCoinbase();
      const confirmations = coinbase
        ? verifiedCoinbaseConfirmations(utxo.confirmations, parent.confirmations)
        : (utxo.confirmations ?? parent.confirmations ?? 0);
      if (coinbase && !isMatureXbtCoinbase(confirmations)) {
        throw new Error('XBT coinbase outputs require 6480 confirmations before spending');
      }
      return { ...utxo, coinbase, confirmations };
    });
  }

  _addPsbtInput(...args: Parameters<HDTaprootWallet['_addPsbtInput']>) {
    const [psbt, input] = args;
    super._addPsbtInput(...args);
    const parent = this.getTransactions().find(transaction => transaction.txid === input.txid);
    if (!parent?.rawHex) throw new Error('Missing authenticated Taproot parent transaction');
    psbt.updateInput(psbt.inputCount - 1, {
      nonWitnessUtxo: Buffer.from(parent.rawHex, 'hex'),
    });
    return psbt;
  }

  private addOwnedOutputMetadata(psbt: bitcoin.Psbt, masterFingerprint: number) {
    const fingerprint = Buffer.alloc(4);
    fingerprint.writeUInt32LE(masterFingerprint);
    psbt.txOutputs.forEach((output, index) => {
      if (!output.address || !this.weOwnAddress(output.address)) return;
      const path = this._getDerivationPathByAddress(output.address);
      const pubkey = this._getPubkeyByAddress(output.address);
      if (!path || !pubkey) throw new Error('Missing owned Taproot output derivation');
      delete psbt.data.outputs[index].tapBip32Derivation;
      delete psbt.data.outputs[index].tapInternalKey;
      psbt.updateOutput(index, {
        tapInternalKey: pubkey,
        tapBip32Derivation: [{ pubkey, masterFingerprint: fingerprint, path, leafHashes: [] }],
      });
    });
  }

  /** Keep every original input and recipient output. Pay the increase only from BIP86 change. */
  createRBFTransaction(
    original: bitcoin.Transaction,
    utxos: CreateTransactionUtxo[],
    feeRate: number,
    skipSigning = false,
    masterFingerprint = 0,
  ): CreateTransactionResult {
    if (!Number.isFinite(feeRate) || feeRate <= 0) throw new Error('Invalid replacement fee rate');
    const known = this.getTransactions().find(transaction => transaction.txid === original.getId());
    if (!known?.rawHex || known.rawHex !== original.toHex() || known.confirmations !== 0) {
      throw new Error('Replacement requires an authenticated unconfirmed wallet transaction');
    }
    if (!original.ins.some(input => input.sequence < 0xfffffffe)) throw new Error('Transaction does not signal RBF');
    const inputs = this.verifyInputs(utxos);
    if (inputs.length !== original.ins.length) throw new Error('Replacement input count changed');
    const spentOutputs = inputs.map((input, index) => {
      const previous = original.ins[index];
      if (
        input.txid !== Buffer.from(previous.hash).reverse().toString('hex') ||
        input.vout !== previous.index ||
        !input.address ||
        !this.weOwnAddress(input.address)
      )
        throw new Error('Replacement input is not controlled by this wallet');
      return {
        value: BigInt(input.value),
        script: bitcoin.address.toOutputScript(input.address),
      };
    });
    assertUnifiedTaprootSignatures(original, spentOutputs, (key, digest, signature) => ecc.verifySchnorr!(digest, key, signature));
    const inputValue = spentOutputs.reduce((sum, output) => sum + output.value, 0n);
    const oldFee = inputValue - original.outs.reduce((sum, output) => sum + output.value, 0n);
    if (oldFee < 0n) throw new Error('Invalid original fee');
    const priced = original.clone();
    priced.ins.forEach((_, index) => priced.setWitness(index, [Buffer.alloc(65)]));
    const fee = BigInt(Math.ceil(priced.virtualSize() * feeRate));
    // BIP125 absolute fee + incremental relay fee (1 sat/vB). A node with a higher policy may still refuse.
    if (
      fee <= oldFee ||
      fee < oldFee + BigInt(priced.virtualSize()) ||
      Number(fee) / priced.virtualSize() <= Number(oldFee) / original.virtualSize()
    ) {
      throw new Error('Replacement fee must cover the original fee plus at least 1 sat/vB');
    }
    let increase = fee - oldFee;
    const outputs = original.outs.map(output => {
      let address: string | undefined;
      try {
        address = bitcoin.address.fromOutputScript(output.script);
      } catch {}
      let value = output.value;
      if (address && this.addressIsChange(address)) {
        const available = value > 330n ? value - 330n : 0n;
        const taken = available < increase ? available : increase;
        value -= taken;
        increase -= taken;
      }
      return { ...output, value };
    });
    if (increase !== 0n) throw new Error('Not enough change to bump the fee without reducing recipient amounts');
    if (fee > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Fee exceeds safe integer range');
    const psbt = new bitcoin.Psbt();
    psbt.setVersion(original.version);
    psbt.setLocktime(original.locktime);
    const fingerprint = Buffer.alloc(4);
    fingerprint.writeUInt32LE(masterFingerprint);
    inputs.forEach((input, index) => {
      this._addPsbtInput(psbt, input, original.ins[index].sequence, fingerprint);
      psbt.updateInput(index, { sighashType: SIGHASH_ALL_UNIFIED });
    });
    outputs.forEach(output => psbt.addOutput({ script: output.script, value: output.value }));
    this.addOwnedOutputMetadata(psbt, masterFingerprint);
    const result = {
      inputs,
      outputs: outputs.map(output => ({ value: Number(output.value) })),
      fee: Number(fee),
      psbt,
    };
    return skipSigning ? result : this.signTransaction(result);
  }
}

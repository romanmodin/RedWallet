import { Journal } from '../xbt/kilojoin/round';
import { assertUnreserved, reservedCoins } from '../xbt/kilojoin/wallet-store';
import { inspectBip84Original, planBip84Replacement } from '../xbt/bip84-replacement';
import { CreateTransactionResult } from './types';
import { ECPairFactory } from 'ecpair';

import ecc from '../../blue_modules/noble_ecc';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { isMatureXbtCoinbase, verifiedCoinbaseConfirmations } from '../xbt/coinbase-maturity';
import { finalizeUnifiedP2wpkhInput, signUnifiedP2wpkhInput, SIGHASH_ALL_UNIFIED } from '../xbt/unified-psbt';
import { AbstractHDElectrumWallet } from './abstract-hd-electrum-wallet';
import { HDSegwitBech32Wallet } from './hd-segwit-bech32-wallet';
import { assertXbtUnifiedTransaction } from '../xbt/broadcast-validation';
import { parseVerifiedParentTransaction } from '../xbt/verified-transaction';
import * as bitcoin from 'bitcoinjs-lib';

const ECPair = ECPairFactory(ecc);

/** XBT BIP84 wallet; its transaction signatures use Knots Unified Sighash. */
export class XbtSegwitBech32Wallet extends HDSegwitBech32Wallet {
  static readonly type = 'HDsegwitBech32XBT';
  static readonly typeReadable = 'XBT SegWit (BIP84)';
  // @ts-ignore: override
  public readonly type = XbtSegwitBech32Wallet.type;
  // @ts-ignore: override
  public readonly typeReadable = XbtSegwitBech32Wallet.typeReadable;
  public readonly segwitType = 'p2wpkh';
  static readonly derivationPath = "m/84'/0'/0'";

  _kilojoinJournals?: Record<string, Journal>;

  // Fee actions remain disabled until authenticated BIP84 replacement and fee review land.
  allowRBF() {
    return false;
  }

  // Authenticated replacement is separate from the blocked legacy cancel/CPFP paths.
  allowAuthenticatedRBF() {
    return true;
  }

  getAuthenticatedRBFInfo(txid: string) {
    const history = this.getTransactions();
    const known = history.find(transaction => transaction.txid === txid);
    if (!known?.rawHex || known.confirmations !== 0) throw new Error('Replacement requires a known unconfirmed transaction');
    const parents = new Map<string, string>();
    history.forEach(transaction => {
      if (transaction.rawHex) parents.set(transaction.txid, transaction.rawHex);
    });
    const result = inspectBip84Original(txid, known.rawHex, parents, script => this.weOwnAddress(bitcoin.address.fromOutputScript(script)));
    return {
      ...result,
      feeRate: result.oldFee / result.original.virtualSize(),
    };
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

  cosignPsbt(_psbt: bitcoin.Psbt): never {
    throw new Error('XBT generic PSBT cosigning is unsupported');
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
    const reserved = reservedCoins(this);
    const transactions = new Map(this.getTransactions().map(transaction => [transaction.txid, transaction]));
    return super.getUtxo(respectFrozen).flatMap(utxo => {
      if (reserved.has(`${utxo.txid}:${utxo.vout}`)) return [];
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

  /** Construct only the authenticated plan; legacy fee routes remain disabled. */
  createAuthenticatedRBFTransaction(txid: string, feeRate: number, skipSigning = false, masterFingerprint = 0): CreateTransactionResult {
    const history = new Map(this.getTransactions().map(transaction => [transaction.txid, transaction]));
    const known = history.get(txid);
    if (!known?.rawHex || known.confirmations !== 0) throw new Error('Replacement requires a known unconfirmed transaction');
    const parents = new Map<string, string>();
    history.forEach((transaction, id) => {
      if (transaction.rawHex) parents.set(id, transaction.rawHex);
    });
    const plan = planBip84Replacement(
      txid,
      known.rawHex,
      parents,
      feeRate,
      script => this.weOwnAddress(bitcoin.address.fromOutputScript(script)),
      script => {
        try {
          return this.addressIsChange(bitcoin.address.fromOutputScript(script));
        } catch {
          return false;
        }
      },
    );
    assertUnreserved(
      this,
      plan.original.ins.map(input => ({ txid: Buffer.from(input.hash).reverse().toString('hex'), vout: input.index })),
    );
    const psbt = new bitcoin.Psbt();
    psbt.setVersion(plan.original.version);
    psbt.setLocktime(plan.original.locktime);
    const fingerprint = Buffer.alloc(4);
    fingerprint.writeUInt32LE(masterFingerprint);
    const inputs = plan.original.ins.map((input, index) => {
      const id = Buffer.from(input.hash).reverse().toString('hex');
      const parent = parseVerifiedParentTransaction(id, parents.get(id)!);
      const output = parent.outs[input.index];
      if (output.value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Input amount exceeds safe range');
      if (parent.isCoinbase() && !isMatureXbtCoinbase(history.get(id)?.confirmations)) {
        throw new Error('XBT coinbase outputs require 6480 confirmations before spending');
      }
      const address = bitcoin.address.fromOutputScript(output.script);
      const utxo = {
        txid: id,
        vout: input.index,
        address,
        value: Number(output.value),
      };
      this._addPsbtInput(psbt, utxo, input.sequence, fingerprint);
      psbt.updateInput(index, {
        sighashType: SIGHASH_ALL_UNIFIED,
        nonWitnessUtxo: Buffer.from(parents.get(id)!, 'hex'),
      });
      return utxo;
    });
    plan.outputs.forEach(output => {
      let address: string;
      try {
        address = bitcoin.address.fromOutputScript(output.script);
      } catch {
        psbt.addOutput(output);
        return;
      }
      if (!this.addressIsChange(address)) {
        psbt.addOutput(output);
        return;
      }
      const path = this._getDerivationPathByAddress(address);
      const pubkey = this._getPubkeyByAddress(address);
      if (!path || !pubkey) throw new Error('Replacement change derivation is unavailable');
      const derivedScript = bitcoin.payments.p2wpkh({ pubkey }).output;
      if (!derivedScript || !Buffer.from(derivedScript).equals(Buffer.from(output.script))) {
        throw new Error('Replacement change derivation does not match output');
      }
      psbt.addOutput({
        ...output,
        bip32Derivation: [{ masterFingerprint: fingerprint, path, pubkey }],
      });
    });
    const result: CreateTransactionResult = {
      inputs,
      outputs: plan.outputs.map(output => ({ value: Number(output.value) })),
      fee: plan.fee,
      psbt,
    };
    if (skipSigning) return result;
    inputs.forEach((input, index) => {
      const wif = this._getWifForAddress(input.address);
      if (!wif) throw new Error('Replacement input key is unavailable');
      const key = ECPair.fromWIF(wif);
      signUnifiedP2wpkhInput(psbt, index, {
        publicKey: key.publicKey,
        sign: digest => key.sign(Buffer.from(digest)),
      });
      finalizeUnifiedP2wpkhInput(psbt, index, key.publicKey, (publicKey, digest, signature) => ecc.verify(digest, publicKey, signature));
    });
    result.tx = psbt.extractTransaction();
    return result;
  }

  createTransaction(...args: Parameters<AbstractHDElectrumWallet['createTransaction']>) {
    const [utxos, targets, feeRate, changeAddress, sequence, skipSigning, masterFingerprint] = args;
    assertUnreserved(this, utxos);
    if (!this.weOwnAddress(changeAddress)) throw new Error('XBT change address is not controlled by this wallet');
    const transactions = new Map(this.getTransactions().map(transaction => [transaction.txid, transaction]));
    const verifiedUtxos = utxos.map(utxo => {
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
    const result = super.createTransaction(verifiedUtxos, targets, feeRate, changeAddress, sequence, true, masterFingerprint);
    result.psbt.data.inputs.forEach((_, inputIndex) => {
      result.psbt.updateInput(inputIndex, { sighashType: SIGHASH_ALL_UNIFIED });
    });
    if (skipSigning) return result;

    result.inputs.forEach((input, inputIndex) => {
      if (!input.address) throw new Error('XBT signing input is missing its wallet address');
      const wif = this._getWifForAddress(input.address);
      if (!wif) throw new Error('XBT signing input is not controlled by this wallet');
      const keyPair = ECPair.fromWIF(wif);
      signUnifiedP2wpkhInput(result.psbt, inputIndex, {
        publicKey: keyPair.publicKey,
        sign: messageHash => keyPair.sign(Buffer.from(messageHash)),
      });
      finalizeUnifiedP2wpkhInput(result.psbt, inputIndex, keyPair.publicKey, (publicKey, messageHash, signature) =>
        ecc.verify(messageHash, publicKey, signature),
      );
    });

    result.tx = result.psbt.extractTransaction();
    return result;
  }
}

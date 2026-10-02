import { ECPairFactory } from 'ecpair';

import ecc from '../../blue_modules/noble_ecc';
import { isCoinbaseTransaction, isMatureXbtCoinbase } from '../xbt/coinbase-maturity';
import { finalizeUnifiedP2wpkhInput, signUnifiedP2wpkhInput, SIGHASH_ALL_UNIFIED } from '../xbt/unified-psbt';
import { AbstractHDElectrumWallet } from './abstract-hd-electrum-wallet';
import { HDSegwitBech32Wallet } from './hd-segwit-bech32-wallet';
import { assertXbtUnifiedTransaction } from '../xbt/broadcast-validation';

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

  allowPayJoin() {
    return false;
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

  getUtxo(respectFrozen = false) {
    const transactions = new Map(this.getTransactions().map(transaction => [transaction.txid, transaction]));
    return super.getUtxo(respectFrozen).flatMap(utxo => {
      const parent = transactions.get(utxo.txid);
      if (!parent) return [];
      const coinbase = isCoinbaseTransaction(parent.inputs);
      const confirmations = utxo.confirmations ?? parent.confirmations;
      if (coinbase && !isMatureXbtCoinbase(confirmations)) return [];
      return [{ ...utxo, coinbase, confirmations }];
    });
  }

  createTransaction(...args: Parameters<AbstractHDElectrumWallet['createTransaction']>) {
    const [utxos, targets, feeRate, changeAddress, sequence, skipSigning, masterFingerprint] = args;
    const transactions = new Map(this.getTransactions().map(transaction => [transaction.txid, transaction]));
    const verifiedUtxos = utxos.map(utxo => {
      const parent = transactions.get(utxo.txid);
      if (!parent) throw new Error('Cannot verify XBT input transaction and coinbase maturity');
      const coinbase = isCoinbaseTransaction(parent.inputs);
      const confirmations = utxo.confirmations ?? parent.confirmations ?? 0;
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

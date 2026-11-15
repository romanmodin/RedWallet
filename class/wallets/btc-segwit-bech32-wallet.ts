import * as bitcoin from 'bitcoinjs-lib';
import * as BtcElectrum from '../../blue_modules/BtcElectrum';
import { HDSegwitBech32Wallet } from './hd-segwit-bech32-wallet';
import { AbstractHDElectrumWallet } from './abstract-hd-electrum-wallet';

/** An explicit Bitcoin wallet. Never reinterpret an existing XBT wallet or its cache. */
export class BtcSegwitBech32Wallet extends HDSegwitBech32Wallet {
  static readonly type = 'HDsegwitBech32BTC';
  static readonly typeReadable = 'BTC · SHA-256 · Native SegWit';
  // @ts-ignore: override
  readonly type = BtcSegwitBech32Wallet.type;
  // @ts-ignore: override
  readonly typeReadable = BtcSegwitBech32Wallet.typeReadable;

  getElectrum() {
    return BtcElectrum.forWallet(this.getID(), () => this.getElectrumAddresses());
  }

  getElectrumAddresses(): string[] {
    const addresses = [];
    for (let i = 0; i < this.next_free_address_index + this.gap_limit; i++) addresses.push(this._getExternalAddressByIndex(i));
    for (let i = 0; i < this.next_free_change_address_index + this.gap_limit; i++) addresses.push(this._getInternalAddressByIndex(i));
    return addresses;
  }

  allowRBF() {
    return false;
  }

  allowPayJoin() {
    return false;
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

  requiresVerifiedTransactions() {
    return true;
  }

  async fetchBalance() {
    if (!(await this.getElectrum().ensureConnected())) throw new Error('Select the blue BTC wallet to refresh Bitcoin.');
    await super.fetchBalance();
  }

  async fetchTransactions() {
    const backend = this.getElectrum();
    if (!(await backend.ensureConnected())) throw new Error('Select the blue BTC wallet to refresh Bitcoin.');
    const histories = await backend.multiGetHistoryByAddress(this.getElectrumAddresses());
    await super.fetchTransactions();
    // The shared cache stops refetching settled transactions after seven blocks.
    // Keep BTC confirmations current so coinbase funds can reach maturity at 100.
    const heights = new Map(
      Object.values(histories)
        .flat()
        .map(entry => [entry.tx_hash, entry.height]),
    );
    const tip = backend.estimateCurrentBlockheight();
    for (const bucket of [this._txs_by_external_index, this._txs_by_internal_index]) {
      for (const transactions of Object.values(bucket)) {
        for (const transaction of transactions) {
          const height = heights.get(transaction.txid);
          if (height !== undefined) transaction.confirmations = height > 0 ? tip - height + 1 : 0;
        }
      }
    }
  }

  private verifyInputs(utxos: Parameters<AbstractHDElectrumWallet['createTransaction']>[0]) {
    const parents = new Map(this.getTransactions().map(tx => [tx.txid, tx]));
    return utxos.map(utxo => {
      const parent = parents.get(utxo.txid);
      if (!parent?.rawHex) throw new Error('Refresh BTC history before spending. The input transaction is unavailable.');
      const raw = bitcoin.Transaction.fromHex(parent.rawHex);
      const output = raw.outs[utxo.vout];
      if (
        raw.getId() !== utxo.txid ||
        !Number.isSafeInteger(utxo.value) ||
        !output ||
        output.value !== BigInt(utxo.value) ||
        !utxo.address ||
        !this.weOwnAddress(utxo.address) ||
        !Buffer.from(output.script).equals(Buffer.from(bitcoin.address.toOutputScript(utxo.address)))
      ) {
        throw new Error('BTC input does not match its verified parent transaction and wallet.');
      }
      if (raw.isCoinbase() && Math.min(utxo.confirmations ?? 0, parent.confirmations ?? 0) < 100) {
        throw new Error('Bitcoin coinbase outputs require 100 confirmations.');
      }
      return utxo;
    });
  }

  getUtxo(respectFrozen = false) {
    return super.getUtxo(respectFrozen).filter(utxo => {
      try {
        this.verifyInputs([utxo]);
        return true;
      } catch {
        return false;
      }
    });
  }

  createTransaction(...args: Parameters<AbstractHDElectrumWallet['createTransaction']>) {
    if (!this.weOwnAddress(args[3])) throw new Error('BTC change address is not controlled by this wallet.');
    this.verifyInputs(args[0]);
    const result = super.createTransaction(...args);
    if (result.tx) BtcElectrum.assertBitcoinPayment(result.tx.toHex());
    return result;
  }

  async broadcastTx(hex: string) {
    return (await this.getElectrum().broadcastV2(hex)) === bitcoin.Transaction.fromHex(hex).getId();
  }
}

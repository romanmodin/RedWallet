import * as bitcoin from 'bitcoinjs-lib';
import * as BlueElectrum from '../blue_modules/BlueElectrum';
import { XbtTaprootWallet } from './wallets/xbt-taproot-wallet';
import { WatchOnlyWallet } from './wallets/watch-only-wallet';
import { CreateTransactionUtxo } from './wallets/types';
import { parseVerifiedParentTransaction } from './xbt/verified-transaction';
import { buildUnsignedTransaction } from './xbt/unified-psbt';

export type TaprootFeeWallet = XbtTaprootWallet | (WatchOnlyWallet & { _hdWalletInstance: XbtTaprootWallet });

export function isXbtTaprootWallet(wallet: unknown): wallet is TaprootFeeWallet {
  return wallet instanceof XbtTaprootWallet || (wallet instanceof WatchOnlyWallet && wallet._hdWalletInstance instanceof XbtTaprootWallet);
}

/** Fee calculations use raw authenticated prevouts, never addresses guessed from a Schnorr witness. */
export class XbtTaprootTransaction {
  private transaction?: bitcoin.Transaction;
  private readonly txid: string;
  constructor(
    hex: string | null,
    txid: string | null,
    private readonly wallet: TaprootFeeWallet,
  ) {
    if (!txid && !hex) throw new Error('A transaction is required');
    if (hex) {
      this.transaction = bitcoin.Transaction.fromHex(hex);
      if (txid && this.transaction.getId() !== txid) throw new Error('Transaction ID mismatch');
    }
    this.txid = txid ?? this.transaction!.getId();
  }

  private async getTransaction() {
    if (!this.transaction) {
      const known = this.wallet.getTransactions().find(transaction => transaction.txid === this.txid);
      const raw = known?.rawHex ?? (await BlueElectrum.multiGetTransactionByTxid([this.txid], false))[this.txid];
      this.transaction = parseVerifiedParentTransaction(this.txid, raw);
    }
    return this.transaction;
  }

  async getRemoteConfirmationsNum() {
    const known = this.wallet.getTransactions().find(transaction => transaction.txid === this.txid);
    if (!known || known.confirmations !== 0) throw new Error('Transaction is not known to be unconfirmed');
    const remote = (await BlueElectrum.multiGetTransactionByTxid([this.txid], true))[this.txid];
    if (
      !remote ||
      remote.txid !== this.txid ||
      (remote.confirmations !== undefined && (!Number.isSafeInteger(remote.confirmations) || remote.confirmations < 0))
    ) {
      throw new Error('Cannot verify transaction confirmation status');
    }
    return remote.confirmations ?? 0;
  }

  async isSequenceReplaceable() {
    return (await this.getTransaction()).ins.some(input => input.sequence < 0xfffffffe);
  }

  async getInfo() {
    const transaction = await this.getTransaction();
    if (transaction.isCoinbase()) throw new Error('Cannot bump a coinbase transaction');
    const ids = transaction.ins.map(input => Buffer.from(input.hash).reverse().toString('hex'));
    const known = new Map(this.wallet.getTransactions().map(tx => [tx.txid, tx.rawHex]));
    const missing = [...new Set(ids.filter(id => !known.get(id)))];
    const remote = missing.length ? await BlueElectrum.multiGetTransactionByTxid(missing, false) : {};
    const inputs: CreateTransactionUtxo[] = transaction.ins.map((input, index) => {
      const parent = parseVerifiedParentTransaction(ids[index], known.get(ids[index]) ?? remote[ids[index]]);
      const output = parent.outs[input.index];
      if (!output || output.value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Missing or oversized parent output');
      let address: string | undefined;
      try {
        address = bitcoin.address.fromOutputScript(output.script);
      } catch {}
      const confirmations = this.wallet.getTransactions().find(tx => tx.txid === ids[index])?.confirmations;
      return {
        txid: ids[index],
        vout: input.index,
        value: Number(output.value),
        address,
        confirmations,
      };
    });
    const totalInput = inputs.reduce((sum, input) => sum + BigInt(input.value), 0n);
    const fee = totalInput - transaction.outs.reduce((sum, output) => sum + output.value, 0n);
    if (fee < 0n || fee > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid parent fee');
    return {
      fee: Number(fee),
      feeRate: Number(fee) / transaction.virtualSize(),
      inputs,
      transaction,
    };
  }

  async isOurTransaction() {
    const { inputs } = await this.getInfo();
    return this.wallet.allowRBF() && inputs.every(input => !!input.address && this.wallet.weOwnAddress(input.address));
  }

  async canBumpTx() {
    if (!(await this.isOurTransaction()) || !(await this.isSequenceReplaceable())) return false;
    return (await this.getTransaction()).outs.some(output => {
      try {
        return output.value > 330n && this.wallet.addressIsChange(bitcoin.address.fromOutputScript(output.script));
      } catch {
        return false;
      }
    });
  }

  async isToUsTransaction() {
    const transaction = await this.getTransaction();
    return (
      this.wallet.allowSend() &&
      transaction.outs.some((output, index) =>
        this.wallet
          .getUtxo()
          .some(
            utxo =>
              utxo.txid === this.txid &&
              utxo.vout === index &&
              BigInt(utxo.value) === output.value &&
              this.wallet.weOwnAddress(utxo.address),
          ),
      )
    );
  }

  async createRBFbumpFee(feeRate: number) {
    if ((await this.getRemoteConfirmationsNum()) !== 0 || !(await this.canBumpTx())) {
      throw new Error('This transaction cannot be replaced');
    }
    const { transaction, inputs } = await this.getInfo();
    return this.wallet.createRBFTransaction(transaction, inputs, feeRate);
  }

  async createCPFPbumpFee(feeRate: number) {
    if (!Number.isFinite(feeRate) || feeRate <= 0) throw new Error('Invalid package fee rate');
    if ((await this.getRemoteConfirmationsNum()) !== 0) throw new Error('Parent is already confirmed');
    await this.wallet.fetchUtxo();
    if (!(await this.isToUsTransaction())) throw new Error('No spendable wallet output remains in this transaction');
    const { transaction, fee: parentFee } = await this.getInfo();
    // Package pricing is limited to one unconfirmed parent; unknown ancestors must not underprice the child.
    const ids = transaction.ins.map(input => Buffer.from(input.hash).reverse().toString('hex'));
    const parents = await BlueElectrum.multiGetTransactionByTxid([...new Set(ids)], true);
    if (
      ids.some(
        id => parents[id]?.txid !== id || !Number.isSafeInteger(parents[id]?.confirmations) || (parents[id]?.confirmations ?? 0) <= 0,
      )
    ) {
      throw new Error('CPFP currently requires the parent to have confirmed inputs');
    }
    const utxos = this.wallet.getUtxo(true).filter(utxo => utxo.txid === this.txid);
    const address = await this.wallet.getChangeAddressAsync();
    let childRate = 1;
    for (let attempt = 0; attempt < 8; attempt++) {
      const result = this.wallet.createTransaction(utxos, [{ address }], childRate, address);
      const priced = result.tx ?? buildUnsignedTransaction(result.psbt);
      if (!result.tx) priced.ins.forEach((_, index) => priced.setWitness(index, [Buffer.alloc(65)]));
      const targetFee = Math.ceil((transaction.virtualSize() + priced.virtualSize()) * feeRate);
      if (priced.outs.length !== 1 || priced.outs[0].value < 330n) throw new Error('CPFP output would be dust');
      if (parentFee + result.fee >= targetFee) return result;
      childRate = Math.max(childRate + 1 / priced.virtualSize(), (targetFee - parentFee) / priced.virtualSize());
    }
    throw new Error('Cannot reach the requested package fee rate');
  }
}

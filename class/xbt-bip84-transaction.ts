import * as bitcoin from 'bitcoinjs-lib';
import * as BlueElectrum from '../blue_modules/BlueElectrum';
import { XbtSegwitBech32Wallet } from './wallets/xbt-segwit-bech32-wallet';

/** Only hot BIP84 replacement is staged here; legacy cancel/CPFP remain disabled. */
export function canUseAuthenticatedBip84Rbf(wallet: unknown): wallet is XbtSegwitBech32Wallet {
  return wallet instanceof XbtSegwitBech32Wallet && wallet.allowAuthenticatedRBF();
}

export class XbtBip84Transaction {
  constructor(
    private readonly txid: string,
    private readonly wallet: XbtSegwitBech32Wallet,
  ) {
    if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error('Invalid transaction ID');
  }

  async getInfo() {
    if (!canUseAuthenticatedBip84Rbf(this.wallet)) throw new Error('Authenticated BIP84 replacement is disabled');
    return this.wallet.getAuthenticatedRBFInfo(this.txid);
  }

  async isOurTransaction() {
    await this.getInfo();
    return true;
  }

  async isSequenceReplaceable() {
    return (await this.getInfo()).original.ins.some(input => input.sequence < 0xfffffffe);
  }

  async canBumpTx() {
    return (await this.getInfo()).original.outs.some(output => {
      try {
        return output.value > 294n && this.wallet.addressIsChange(bitcoin.address.fromOutputScript(output.script));
      } catch {
        return false;
      }
    });
  }

  async getRemoteConfirmationsNum() {
    await this.getInfo();
    // Remote metadata can veto replacement, but cannot select recipients, values or fees.
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

  async createRBFbumpFee(feeRate: number) {
    if ((await this.getRemoteConfirmationsNum()) !== 0 || !(await this.canBumpTx())) {
      throw new Error('This transaction cannot be replaced');
    }
    // Re-authenticate local history immediately before signing, after asynchronous checks.
    return this.wallet.createAuthenticatedRBFTransaction(this.txid, feeRate);
  }
}

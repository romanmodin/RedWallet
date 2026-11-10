import { WatchOnlyWallet } from './watch-only-wallet';
import { BtcSegwitBech32Wallet } from './btc-segwit-bech32-wallet';
import { HDSegwitBech32Wallet } from './hd-segwit-bech32-wallet';
import * as BtcElectrum from '../../blue_modules/BtcElectrum';

/** Public BIP84 account only. No local or external signing is enabled. */
export class BtcWatchOnlyWallet extends WatchOnlyWallet {
  static readonly type = 'watchOnlyBTC';
  static readonly typeReadable = 'BTC · SHA-256 · Watch-only';
  // @ts-ignore: distinct persisted wallet type
  readonly type = BtcWatchOnlyWallet.type;
  // @ts-ignore: distinct persisted wallet label
  readonly typeReadable = BtcWatchOnlyWallet.typeReadable;

  setSecret(value: string): this {
    let text = value.trim();
    if (text.startsWith('{')) {
      const data = JSON.parse(text);
      // Single-account hardware exports used by Sparrow and Electrum.
      let key = data.xpub,
        path = data.path,
        fingerprint = data.xfp;
      if (data.keystores) {
        if (data.policyType !== 'SINGLE' || data.scriptType !== 'P2WPKH' || data.keystores.length !== 1)
          throw new Error('Only single-key BIP84 cold-wallet accounts are supported.');
        const account = data.keystores[0];
        key = account.extendedPublicKey;
        path = account.keyDerivation?.derivationPath;
        fingerprint = account.keyDerivation?.masterFingerprint;
      } else if (data.keystore) {
        if (data.wallet_type && data.wallet_type !== 'standard') throw new Error('Multisig BTC import is not supported.');
        key = data.keystore.xpub;
        path = data.keystore.derivation;
        fingerprint = data.keystore.root_fingerprint;
      } else if (data.ExtPubKey) {
        key = data.ExtPubKey;
        path = data.AccountKeyPath;
        fingerprint = data.MasterFingerprint;
      }
      if (
        typeof key !== 'string' ||
        typeof path !== 'string' ||
        typeof fingerprint !== 'string' ||
        !/^[0-9a-fA-F]{8}$/.test(fingerprint) ||
        !/^m\/84['h]\/0['h]\/\d+['h]$/.test(path)
      )
        throw new Error('Export a single BIP84 Native SegWit public account for BTC.');
      text = '[' + fingerprint + '/' + path.slice(2) + ']' + key;
    }
    if (text.startsWith('wpkh(')) {
      if (
        !/^wpkh\(\[[0-9a-fA-F]{8}\/84['h]\/0['h]\/\d+['h]\](?:xpub|zpub)[1-9A-HJ-NP-Za-km-z]+\/(?:0|<0;1>)\/\*\)(?:#[a-z0-9]{8})?$/.test(
          text,
        )
      )
        throw new Error('Only standard single-key BIP84 account descriptors are supported.');
    } else if (!/^(?:zpub[1-9A-HJ-NP-Za-km-z]+|\[[0-9a-fA-F]{8}\/84['h]\/0['h]\/\d+['h]\](?:xpub|zpub)[1-9A-HJ-NP-Za-km-z]+)$/.test(text)) {
      throw new Error('Export a BIP84 Native SegWit public account for BTC; other script types are not supported yet.');
    }
    return super.setSecret(text);
  }

  getID() {
    return 'btc-watch:' + super.getID();
  }

  getElectrum() {
    return BtcElectrum.forWallet(this.getID());
  }

  allowSend() {
    return false;
  }

  isXbtSigningCompatible() {
    return false;
  }

  init() {
    if (this.xbt_network || this.xbt_signer_enabled) throw new Error('Conflicting watch-only wallet network');
    super.init();
    if (!(this._hdWalletInstance instanceof HDSegwitBech32Wallet) || !super.isXbtSigningCompatible()) {
      throw new Error('BTC cold-wallet import currently supports mainnet BIP84 Native SegWit public accounts only.');
    }
    const btc = new BtcSegwitBech32Wallet();
    for (const key of Object.keys(this._hdWalletInstance)) {
      if (key === 'type' || key === 'typeReadable') continue;
      // Preserve the account metadata and cached public history, never the old wallet type.
      // @ts-ignore: same public HD wallet state
      btc[key] = this._hdWalletInstance[key];
    }
    btc.getElectrum = () => this.getElectrum();
    this._hdWalletInstance = btc;
    return this;
  }
}

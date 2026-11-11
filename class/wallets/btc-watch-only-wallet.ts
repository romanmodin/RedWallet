import * as bitcoin from 'bitcoinjs-lib';
import { assertSignedBtcTransaction, btcSigningReview } from '../btc/psbt';
import { WatchOnlyWallet } from './watch-only-wallet';
import { BtcSegwitBech32Wallet } from './btc-segwit-bech32-wallet';
import { HDSegwitBech32Wallet } from './hd-segwit-bech32-wallet';
import * as BtcElectrum from '../../blue_modules/BtcElectrum';

const requests = new WeakMap<BtcWatchOnlyWallet, string>();
const approved = new WeakMap<BtcWatchOnlyWallet, string>();

/** Public BIP84 account; standard BTC external signing requires explicit opt-in. */
export class BtcWatchOnlyWallet extends WatchOnlyWallet {
  static readonly type = 'watchOnlyBTC';
  static readonly typeReadable = 'BTC · SHA-256 · Watch-only';
  // @ts-ignore: distinct persisted wallet type
  readonly type = BtcWatchOnlyWallet.type;
  // @ts-ignore: distinct persisted wallet label
  readonly typeReadable = BtcWatchOnlyWallet.typeReadable;

  btc_signer_enabled = false;

  setSecret(value: string): this {
    requests.delete(this);
    approved.delete(this);
    this.btc_signer_enabled = false;
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
    return BtcElectrum.forWallet(this.getID(), () =>
      this._hdWalletInstance instanceof BtcSegwitBech32Wallet ? this._hdWalletInstance.getElectrumAddresses() : [],
    );
  }

  allowSend() {
    return this.useWithHardwareWalletEnabled() && this._hdWalletInstance instanceof BtcSegwitBech32Wallet;
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

  useWithHardwareWalletEnabled() {
    return this.btc_signer_enabled === true && !this.xbt_network && !this.xbt_signer_enabled;
  }

  setUseWithHardwareWalletEnabled(enabled: boolean) {
    requests.delete(this);
    approved.delete(this);
    if (!(this._hdWalletInstance instanceof BtcSegwitBech32Wallet)) throw new Error('Import a BTC BIP84 public account first.');
    if (enabled && (!Number.isInteger(this.masterFingerprint) || this.masterFingerprint <= 0 || this.masterFingerprint > 0xffffffff))
      throw new Error('Export the account with its master fingerprint from your signing device.');
    this.btc_signer_enabled = !!enabled;
    this.use_with_hardware_wallet = false;
  }

  createTransaction(
    ...args: Parameters<BtcSegwitBech32Wallet['createTransaction']>
  ): ReturnType<BtcSegwitBech32Wallet['createTransaction']> {
    requests.delete(this);
    approved.delete(this);
    if (!this.allowSend() || !(this._hdWalletInstance instanceof BtcSegwitBech32Wallet))
      throw new Error('Enable BTC hardware signing first.');
    const [utxos, targets, feeRate, change, sequence] = args;
    const result = this._hdWalletInstance.createTransaction(utxos, targets, feeRate, change, sequence, true, 0);
    // Keep full fingerprint bytes (including leading zeroes), and declare the sole supported sighash.
    const fingerprint = Buffer.from(this.getMasterFingerprintHex(), 'hex');
    result.psbt.data.inputs.forEach((input, index) => {
      result.psbt.updateInput(index, {
        sighashType: bitcoin.Transaction.SIGHASH_ALL,
      });
      input.bip32Derivation = input.bip32Derivation?.map(key => ({
        ...key,
        masterFingerprint: fingerprint,
      }));
    });
    result.psbt.data.outputs.forEach(output => {
      if (output.bip32Derivation?.length)
        output.bip32Derivation = output.bip32Derivation.map(key => ({
          ...key,
          masterFingerprint: fingerprint,
        }));
    });
    requests.set(this, result.psbt.toBase64());
    return result;
  }

  private signingRequest(value: bitcoin.Psbt | string) {
    const request = typeof value === 'string' ? bitcoin.Psbt.fromBase64(value) : value.clone();
    if (!this.allowSend() || requests.get(this) !== request.toBase64())
      throw new Error('BTC signing request is no longer current. Review a new transaction.');
    return request;
  }

  getSigningReview(value: bitcoin.Psbt | string) {
    return btcSigningReview(this.signingRequest(value), address => this.weOwnAddress(address));
  }

  acceptSignedTransaction(hex: string, value: bitcoin.Psbt | string) {
    approved.delete(this);
    const tx = assertSignedBtcTransaction(hex, this.signingRequest(value));
    approved.set(this, tx.toHex());
    return tx;
  }

  combinePsbt(one: bitcoin.Psbt | string, two: bitcoin.Psbt | string) {
    approved.delete(this);
    const request = this.signingRequest(one);
    const signed = typeof two === 'string' ? bitcoin.Psbt.fromBase64(two) : two.clone();
    const combined = request.clone().combine(signed);
    for (let index = 0; index < combined.inputCount; index++) {
      if (!combined.data.inputs[index].finalScriptWitness) combined.finalizeInput(index);
    }
    return this.acceptSignedTransaction(combined.extractTransaction().toHex(), request);
  }

  async broadcastTx(hex: string): Promise<boolean> {
    if (!this.allowSend() || approved.get(this) !== hex || !(this._hdWalletInstance instanceof BtcSegwitBech32Wallet))
      throw new Error('BTC transaction must match the verified signing request.');
    const request = requests.get(this);
    if (!request) throw new Error('Review a new BTC transaction.');
    assertSignedBtcTransaction(hex, bitcoin.Psbt.fromBase64(request));
    return this._hdWalletInstance.broadcastTx(hex);
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

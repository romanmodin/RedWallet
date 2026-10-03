import BIP32Factory from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';
import { AbstractWallet } from './abstract-wallet';
import { HDLegacyP2PKHWallet } from './hd-legacy-p2pkh-wallet';
import { HDSegwitBech32Wallet } from './hd-segwit-bech32-wallet';
import { HDSegwitP2SHWallet } from './hd-segwit-p2sh-wallet';
import { LegacyWallet } from './legacy-wallet';
import { THDWalletForWatchOnly } from './types';
import { HDTaprootWallet } from './hd-taproot-wallet';
import { XbtSegwitBech32Wallet } from './xbt-segwit-bech32-wallet';
import { assertSignedUnifiedTransactionMatchesPsbt, finalizeUnifiedP2wpkhInput, SIGHASH_ALL_UNIFIED } from '../xbt/unified-psbt';

const bip32 = BIP32Factory(ecc);
const pendingSigningRequests = new WeakMap<WatchOnlyWallet, string>();
const approvedExternalTransactions = new WeakMap<WatchOnlyWallet, string>();

export class WatchOnlyWallet extends LegacyWallet {
  static readonly type = 'watchOnly';
  static readonly typeReadable = 'Watch-only';
  // @ts-ignore: override
  public readonly type = WatchOnlyWallet.type;
  // @ts-ignore: override
  public readonly typeReadable = WatchOnlyWallet.typeReadable;
  public isWatchOnlyWarningVisible = true;

  public _hdWalletInstance?: THDWalletForWatchOnly;
  use_with_hardware_wallet = false;
  xbt_network = false;
  xbt_signer_enabled = false;
  masterFingerprint: number = 0;

  /**
   * @inheritDoc
   */
  getLastTxFetch() {
    if (this._hdWalletInstance) return this._hdWalletInstance.getLastTxFetch();
    return super.getLastTxFetch();
  }

  timeToRefreshTransaction() {
    if (this._hdWalletInstance) return this._hdWalletInstance.timeToRefreshTransaction();
    return super.timeToRefreshTransaction();
  }

  timeToRefreshBalance() {
    if (this._hdWalletInstance) return this._hdWalletInstance.timeToRefreshBalance();
    return super.timeToRefreshBalance();
  }

  allowSend() {
    return this.useWithHardwareWalletEnabled() && this._hdWalletInstance instanceof XbtSegwitBech32Wallet;
  }

  allowRBF() {
    return false;
  }

  allowSignVerifyMessage() {
    return false;
  }

  getAddress() {
    if (this.isAddressValid(this.secret)) return this.secret; // handling case when there is an XPUB there
    if (this._hdWalletInstance) throw new Error('Should not be used in watch-only HD wallets');
    throw new Error('Not initialized');
  }

  valid() {
    if (this.secret.startsWith('xpub') || this.secret.startsWith('ypub') || this.secret.startsWith('zpub')) return this.isXpubValid();

    try {
      bitcoin.address.toOutputScript(this.getAddress());
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * this method creates appropriate HD wallet class, depending on whether we have xpub, ypub or zpub
   * as a property of `this`, and in case such property exists - it recreates it and copies data from old one.
   * this is needed after serialization/save/load/deserialization procedure.
   */
  init() {
    let hdWalletInstance: THDWalletForWatchOnly;

    // Check script type first (most reliable - parsed from descriptor)
    if (this.segwitType === 'p2tr') {
      hdWalletInstance = new HDTaprootWallet();
    } else if (this.segwitType === 'p2wpkh') {
      hdWalletInstance = new HDSegwitBech32Wallet();
    } else if (this.segwitType === 'p2sh(p2wpkh)') {
      hdWalletInstance = new HDSegwitP2SHWallet();
    } else if (this.segwitType === 'p2pkh') {
      hdWalletInstance = new HDLegacyP2PKHWallet();
    }
    // Fallback to path-based detection (for bare [fingerprint/path]xpub without descriptor wrapper)
    else if (this._derivationPath?.startsWith("m/86'")) {
      // if path is explicit taproot path - its definately BIP86
      hdWalletInstance = new HDTaprootWallet();
    } else if (this._derivationPath?.startsWith("m/84'")) {
      hdWalletInstance = new HDSegwitBech32Wallet();
    } else if (this._derivationPath?.startsWith("m/49'")) {
      hdWalletInstance = new HDSegwitP2SHWallet();
    }
    // Final fallback to xpub prefix (legacy behavior for bare xpub/ypub/zpub)
    else if (this.secret.startsWith('xpub')) {
      hdWalletInstance = new HDLegacyP2PKHWallet();
    } else if (this.secret.startsWith('ypub')) hdWalletInstance = new HDSegwitP2SHWallet();
    else if (this.secret.startsWith('zpub')) hdWalletInstance = new HDSegwitBech32Wallet();
    else return this;
    if (this.xbt_network) {
      if (!(hdWalletInstance instanceof HDSegwitBech32Wallet)) throw new Error('XBT watch-only signing requires Native SegWit');
      hdWalletInstance = new XbtSegwitBech32Wallet();
    }
    hdWalletInstance._xpub = this.secret;

    // if derivation path recovered from JSON file it should be moved to hdWalletInstance
    if (this._derivationPath) {
      hdWalletInstance._derivationPath = this._derivationPath;
    }

    if (this._hdWalletInstance) {
      // now, porting all properties from old object to new one
      for (const k of Object.keys(this._hdWalletInstance)) {
        if (k === 'type' || k === 'typeReadable') continue;
        // @ts-ignore: JS magic here
        hdWalletInstance[k] = this._hdWalletInstance[k];
      }

      // deleting properties that cant survive serialization/deserialization:
      delete hdWalletInstance._node1;
      delete hdWalletInstance._node0;
    }
    this._hdWalletInstance = hdWalletInstance;

    return this;
  }

  prepareForSerialization() {
    if (this._hdWalletInstance) {
      delete this._hdWalletInstance._node0;
      delete this._hdWalletInstance._node1;
      delete this._hdWalletInstance._bip47_instance;
    }
  }

  getBalance() {
    if (this._hdWalletInstance) return this._hdWalletInstance.getBalance();
    return super.getBalance();
  }

  getTransactions() {
    if (this._hdWalletInstance) return this._hdWalletInstance.getTransactions();
    return super.getTransactions();
  }

  async fetchBalance() {
    if (this.secret.startsWith('xpub') || this.secret.startsWith('ypub') || this.secret.startsWith('zpub')) {
      if (!this._hdWalletInstance) this.init();
      if (!this._hdWalletInstance) throw new Error('Internal error: _hdWalletInstance is not initialized');
      return this._hdWalletInstance.fetchBalance();
    } else {
      // return LegacyWallet.prototype.fetchBalance.call(this);
      return super.fetchBalance();
    }
  }

  async fetchTransactions() {
    if (this.secret.startsWith('xpub') || this.secret.startsWith('ypub') || this.secret.startsWith('zpub')) {
      if (!this._hdWalletInstance) this.init();
      if (!this._hdWalletInstance) throw new Error('Internal error: _hdWalletInstance is not initialized');
      return this._hdWalletInstance.fetchTransactions();
    } else {
      // return LegacyWallet.prototype.fetchBalance.call(this);
      return super.fetchTransactions();
    }
  }

  async getAddressAsync(): Promise<string> {
    if (this.isAddressValid(this.secret)) return new Promise(resolve => resolve(this.secret));
    if (this._hdWalletInstance) return this._hdWalletInstance.getAddressAsync();
    throw new Error('Not initialized');
  }

  _getExternalAddressByIndex(index: number) {
    if (this._hdWalletInstance) return this._hdWalletInstance._getExternalAddressByIndex(index);
    throw new Error('Not initialized');
  }

  _getInternalAddressByIndex(index: number) {
    if (this._hdWalletInstance) return this._hdWalletInstance._getInternalAddressByIndex(index);
    throw new Error('Not initialized');
  }

  getNextFreeAddressIndex() {
    if (this._hdWalletInstance) return this._hdWalletInstance.next_free_address_index;
    throw new Error('Not initialized');
  }

  getNextFreeChangeAddressIndex() {
    if (this._hdWalletInstance) return this._hdWalletInstance.next_free_change_address_index;
    throw new Error('Not initialized');
  }

  async getChangeAddressAsync() {
    if (this._hdWalletInstance) return this._hdWalletInstance.getChangeAddressAsync();
    throw new Error('Not initialized');
  }

  async fetchUtxo() {
    if (this._hdWalletInstance) return this._hdWalletInstance.fetchUtxo();
    // Single-address watch-only uses LegacyWallet UTXO + derivation from txs (no HD instance).
    return super.fetchUtxo();
  }

  getUtxo(...args: Parameters<THDWalletForWatchOnly['getUtxo']>) {
    if (this._hdWalletInstance) return this._hdWalletInstance.getUtxo(...args);
    return super.getUtxo(...args);
  }

  combinePsbt(..._args: Parameters<THDWalletForWatchOnly['combinePsbt']>): ReturnType<THDWalletForWatchOnly['combinePsbt']> {
    if (!this.allowSend()) throw new Error('Enable an XBT-compatible external signer first');
    approvedExternalTransactions.delete(this);
    const [one, two] = _args;
    const expected = typeof one === 'string' ? bitcoin.Psbt.fromBase64(one) : one.clone();
    if (expected.data.inputs.some(input => input.sighashType !== SIGHASH_ALL_UNIFIED)) {
      throw new Error('Reviewed PSBT does not declare XBT Unified Sighash on every input');
    }
    if (pendingSigningRequests.get(this) !== expected.toBase64())
      throw new Error('PSBT does not match the current reviewed signing request');
    const signed = typeof two === 'string' ? bitcoin.Psbt.fromBase64(two) : two.clone();
    const combined = expected.clone().combine(signed);
    combined.data.inputs.forEach((input, index) => {
      if (!input.finalScriptWitness) {
        const publicKey = input.partialSig?.[0]?.pubkey;
        if (!publicKey) throw new Error('External signer did not sign every input');
        finalizeUnifiedP2wpkhInput(combined, index, publicKey, (key, digest, signature) => ecc.verify(digest, key, signature));
      }
    });
    const transaction = combined.extractTransaction();
    assertSignedUnifiedTransactionMatchesPsbt(transaction.toHex(), expected, (key, digest, signature) =>
      ecc.verify(digest, key, signature),
    );
    approvedExternalTransactions.set(this, transaction.toHex());
    return transaction;
  }

  async broadcastTx(..._args: Parameters<THDWalletForWatchOnly['broadcastTx']>): Promise<boolean> {
    if (!this.allowSend() || !(this._hdWalletInstance instanceof XbtSegwitBech32Wallet))
      throw new Error('Enable an XBT-compatible external signer first');
    if (approvedExternalTransactions.get(this) !== _args[0])
      throw new Error('External transaction must match the verified signing request');
    return this._hdWalletInstance.broadcastTx(_args[0]);
  }

  /**
   * signature of this method is the same ad BIP84 createTransaction, BUT this method should be used to create
   * unsinged PSBT to be used with HW wallet (or other external signer)
   */
  createTransaction(
    ..._args: Parameters<THDWalletForWatchOnly['createTransaction']>
  ): ReturnType<THDWalletForWatchOnly['createTransaction']> {
    if (!this.allowSend() || !(this._hdWalletInstance instanceof XbtSegwitBech32Wallet))
      throw new Error('Enable an XBT-compatible external signer first');
    approvedExternalTransactions.delete(this);
    const [utxos, targets, feeRate, changeAddress, sequence] = _args;
    pendingSigningRequests.delete(this);
    const result = this._hdWalletInstance.createTransaction(
      utxos,
      targets,
      feeRate,
      changeAddress,
      sequence,
      true,
      this.getMasterFingerprint(),
    );
    pendingSigningRequests.set(this, result.psbt.toBase64());
    return result;
  }

  getMasterFingerprint() {
    return this.masterFingerprint;
  }

  getMasterFingerprintHex() {
    if (!this.masterFingerprint) return '00000000';
    let masterFingerprintHex = Number(this.masterFingerprint).toString(16);
    if (masterFingerprintHex.length < 8) masterFingerprintHex = '0' + masterFingerprintHex; // conversion without explicit zero might result in lost byte
    // poor man's little-endian conversion:
    // ¯\_(ツ)_/¯
    return (
      masterFingerprintHex[6] +
      masterFingerprintHex[7] +
      masterFingerprintHex[4] +
      masterFingerprintHex[5] +
      masterFingerprintHex[2] +
      masterFingerprintHex[3] +
      masterFingerprintHex[0] +
      masterFingerprintHex[1]
    );
  }

  isHd() {
    return this.secret.startsWith('xpub') || this.secret.startsWith('ypub') || this.secret.startsWith('zpub');
  }

  weOwnAddress(address: string) {
    if (this.isHd()) {
      if (this._hdWalletInstance) return this._hdWalletInstance.weOwnAddress(address);
      throw new Error('Not initialized');
    }

    if (address && address.startsWith('BC1')) address = address.toLowerCase();

    return this.getAddress() === address;
  }

  allowMasterFingerprint() {
    return this.getSecret().startsWith('zpub') || this.getSecret().startsWith('ypub') || this.getSecret().startsWith('xpub');
  }

  useWithHardwareWalletEnabled() {
    return this.xbt_signer_enabled === true && this.xbt_network === true;
  }

  setUseWithHardwareWalletEnabled(enabled: boolean) {
    approvedExternalTransactions.delete(this);
    pendingSigningRequests.delete(this);
    if (enabled && !this.isXbtSigningCompatible()) throw new Error('XBT external signing requires a BIP84 Native SegWit account');
    if (enabled) this.xbt_network = true;
    this.xbt_signer_enabled = !!enabled;
    this.use_with_hardware_wallet = false; // Old BTC hardware flags never grant XBT signing permission.
    this.init();
  }

  isXbtSigningCompatible() {
    if (!(this._hdWalletInstance instanceof HDSegwitBech32Wallet)) return false;
    const account = /^m\/84'\/0'\/(\d+)'$/.exec(this.getDerivationPath() ?? '');
    if (!account) return false;
    try {
      const node = bip32.fromBase58(this.secret.startsWith('zpub') ? this._zpubToXpub(this.secret) : this.secret);
      return node.depth === 3 && node.index === 0x80000000 + Number(account[1]);
    } catch {
      return false;
    }
  }

  /**
   * @inheritDoc
   */
  getAllExternalAddresses() {
    if (this._hdWalletInstance) return this._hdWalletInstance.getAllExternalAddresses();
    return super.getAllExternalAddresses();
  }

  isXpubValid() {
    let xpub;

    try {
      if (this.secret.startsWith('zpub')) {
        xpub = this._zpubToXpub(this.secret);
      } else if (this.secret.startsWith('ypub')) {
        xpub = AbstractWallet._ypubToXpub(this.secret);
      } else {
        xpub = this.secret;
      }

      const hdNode = bip32.fromBase58(xpub);
      hdNode.derive(0);
      return true;
    } catch (_) {}

    return false;
  }

  addressIsChange(...args: Parameters<THDWalletForWatchOnly['addressIsChange']>) {
    if (this._hdWalletInstance) return this._hdWalletInstance.addressIsChange(...args);
    return super.addressIsChange(...args);
  }

  getUTXOMetadata(...args: Parameters<THDWalletForWatchOnly['getUTXOMetadata']>) {
    if (this._hdWalletInstance) return this._hdWalletInstance.getUTXOMetadata(...args);
    return super.getUTXOMetadata(...args);
  }

  setUTXOMetadata(...args: Parameters<THDWalletForWatchOnly['setUTXOMetadata']>) {
    if (this._hdWalletInstance) return this._hdWalletInstance.setUTXOMetadata(...args);
    return super.setUTXOMetadata(...args);
  }

  getDerivationPath(...args: Parameters<THDWalletForWatchOnly['getDerivationPath']>) {
    if (this._hdWalletInstance) return this._hdWalletInstance.getDerivationPath(...args);
    throw new Error("Not a HD watch-only wallet, can't use derivation path");
  }

  setDerivationPath(...args: Parameters<THDWalletForWatchOnly['setDerivationPath']>) {
    if (this._hdWalletInstance) return this._hdWalletInstance.setDerivationPath(...args);
    throw new Error("Not a HD watch-only wallet, can't use derivation path");
  }

  isSegwit(): boolean {
    if (this._hdWalletInstance) return this._hdWalletInstance.isSegwit();
    return super.isSegwit();
  }

  wasEverUsed(): Promise<boolean> {
    if (this._hdWalletInstance) return this._hdWalletInstance.wasEverUsed();
    return super.wasEverUsed();
  }
}

import { NativeModules } from 'react-native';
import { LegacyWallet } from './legacy-wallet';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import { LndDisplayUnit } from '../../blue_modules/lnd-display-amount';
import { LightningTransaction, Transaction } from './types';

export type LndActivity = {
  id: string;
  direction: 'sent' | 'received';
  sats: string;
  feeSats: string;
  timestamp: number;
  state: 'unpaid' | 'pending' | 'settled' | 'failed' | 'canceled' | 'expired' | 'unknown' | 'confirmed' | 'conflicted';
  memo: string;
  confirmations?: number;
};
export type LndActivityPage = {
  rows: LndActivity[];
  next: string;
  more: boolean;
};
export type LndOverview = {
  node: string;
  synced: boolean;
  height: string;
  peers: string;
  activeChannels: string;
  fundingTotal: string;
  fundingConfirmed: string;
  fundingPending: string;
  fundingLocked: string;
  anchorReserve: string;
  lightningLocal: string;
  lightningRemote: string;
  channelPending: string;
  splicePending: string;
};

const sats = (value: string): number => {
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid LND balance.');
  return Number(value);
};

/** A card referencing the ONE embedded node. Keys and channel state remain native.
 * Never use inherited on-chain signing/address APIs: all sends use the native review flow.
 */
export class LndWallet extends LegacyWallet {
  static readonly type = 'lndWallet';
  static readonly typeReadable = 'XBT Lightning · LND';
  // @ts-ignore subclass discriminator
  readonly type = LndWallet.type;
  readonly typeReadable = LndWallet.typeReadable;
  overview?: LndOverview;
  observedAt = 0;
  status = 'Checking';
  activity: LndActivity[] = [];
  displayUnit?: LndDisplayUnit;

  static fromJson(raw: string): LndWallet {
    const stored = JSON.parse(raw);
    const wallet = new LndWallet();
    if (typeof stored.label === 'string') wallet.label = stored.label;
    wallet.hideBalance = stored.hideBalance === true;
    wallet.setPreferredBalanceUnit(stored.preferredBalanceUnit);
    if (['XBT', 'sats', 'quote'].includes(stored.displayUnit)) wallet.setDisplayUnit(stored.displayUnit);
    wallet.userHasSavedExport = stored.userHasSavedExport === true;
    wallet._hideTransactionsInWalletsList = stored._hideTransactionsInWalletsList === true;
    if (stored.overview) {
      wallet.overview = stored.overview;
      wallet.getBalance(); // Fail closed on invalid serialized amounts.
    }
    if (Array.isArray(stored.activity)) wallet.activity = stored.activity;
    return wallet; // never restore connection timestamps or a native secret
  }

  constructor() {
    super(LndWallet.typeReadable);
    this.chain = Chain.OFFCHAIN;
    this.label = 'XBT Lightning';
  }

  getDisplayUnit(): LndDisplayUnit {
    return this.displayUnit ?? (this.getPreferredBalanceUnit() === BitcoinUnit.SATS ? 'sats' : 'XBT');
  }

  setDisplayUnit(unit: LndDisplayUnit): void {
    if (!['XBT', 'sats', 'quote'].includes(unit)) return;
    this.displayUnit = unit;
    // Keep exact legacy displays in step without enabling the unrelated BTC fiat rate cache.
    if (unit !== 'quote') this.setPreferredBalanceUnit(unit === 'sats' ? BitcoinUnit.SATS : BitcoinUnit.BTC);
  }

  // A fixed identity deduplicates cards without exposing the native seed to JS.
  getID(): string {
    return 'embedded-xbt-lnd';
  }

  getSecret(): string {
    return '';
  }

  getAddress(): false {
    return false;
  }

  getAllExternalAddresses(): string[] {
    return [];
  }

  allowSend(): boolean {
    return false;
  }

  allowReceive(): boolean {
    return false;
  }

  async allowOnchainAddress(): Promise<boolean> {
    return false;
  }

  async generate(): Promise<void> {
    throw new Error('Use Lightning node setup.');
  }

  async generateFromEntropy(): Promise<void> {
    throw new Error('Use Lightning recovery in node settings.');
  }

  async fetchUtxo(): Promise<void> {
    this._utxo = [];
  }

  async fetchTransactions(): Promise<void> {
    const bridge = NativeModules.XBTLightningBridge;
    if (!bridge?.wallet || this.status !== 'Running') return;
    const [payments, invoices]: LndActivityPage[] = await Promise.all([bridge.wallet('payments', '0'), bridge.wallet('invoices', '0')]);
    this.activity = [...payments.rows, ...invoices.rows];
    this._lastTxFetch = Date.now();
  }

  getTransactions(): (Transaction & LightningTransaction)[] {
    // The global feed uses successful-payment rows. The wallet tab retains
    // every pending, failed and unpaid record with its real native status.
    return this.activity
      .filter(row => row.state === 'settled')
      .map(
        row =>
          ({
            txid: 'lnd-' + row.direction + '-' + row.id,
            hash: '',
            walletID: this.getID(),
            type: row.direction === 'sent' ? 'paid_invoice' : 'user_invoice',
            timestamp: row.timestamp,
            value: Number(row.sats) * (row.direction === 'sent' ? -1 : 1),
            payment_hash: row.id,
            ispaid: true,
            memo: row.memo,
            fee: Number(row.feeSats),
          }) as Transaction & LightningTransaction,
      );
  }

  // Global chain totals include on-chain funding and local channel funds exactly once.
  // Remote liquidity, reserves (already inside fundingTotal), and unsettled incoming HTLCs are never added.
  getBalance(): number {
    const o = this.overview;
    return o ? sats(o.fundingTotal) + sats(o.lightningLocal) + sats(o.channelPending) + sats(o.splicePending) : 0;
  }

  timeToRefreshBalance(): boolean {
    return Date.now() - this.observedAt > 15_000;
  }

  async fetchBalance(): Promise<void> {
    const bridge = NativeModules.XBTLightningBridge;
    if (!bridge?.wallet) {
      this.status = 'Unavailable';
      this.observedAt = 0;
      return;
    }
    try {
      const status = await bridge.run('status', '');
      this.status = status;
      if (status !== 'Running') {
        this.observedAt = 0;
        return;
      }
      const next: LndOverview = await bridge.wallet('overview', '');
      for (const key of ['fundingTotal', 'lightningLocal', 'channelPending', 'splicePending'] as const) sats(next[key]);
      this.overview = next;
      this.observedAt = Date.now();
      this._lastBalanceFetch = this.observedAt;
    } catch (error) {
      this.observedAt = 0;
      this.status = 'Connection unavailable';
      throw error;
    }
  }

  connection(now = Date.now()): 'connected' | 'checking' | 'disconnected' {
    if (!this.observedAt || now - this.observedAt > 30_000) return 'disconnected';
    return this.status === 'Running' && this.overview?.synced && Number(this.overview.peers) > 0 ? 'connected' : 'checking';
  }
}

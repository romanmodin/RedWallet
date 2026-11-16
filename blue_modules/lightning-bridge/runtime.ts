import * as Keychain from 'react-native-keychain';
import { NativeModules } from 'react-native';
import {
  BridgeBackend,
  BridgeController,
  BridgeJournal,
  BridgeStore,
  NodePayment,
  SwapRecord,
  validateJournal,
  validateJournalAsync,
} from './state';
import { lightningBridgeProviders } from './provider';

const service = 'com.redwallet.lightning-cross-chain.v1';
export const bridgeStore: BridgeStore = {
  async read(): Promise<BridgeJournal> {
    const stored = await Keychain.getGenericPassword({ service });
    if (!stored) return { version: 1, records: [], requests: [] };
    return validateJournalAsync(JSON.parse(stored.password));
  },
  async write(journal: BridgeJournal): Promise<void> {
    validateJournal(journal);
    const result = await Keychain.setGenericPassword(service, JSON.stringify(journal), {
      service,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    if (!result) throw new Error('Could not securely save bridge payment state. No automatic retry is allowed.');
  },
};
const native = () => {
  const bridge = NativeModules.XBTLightningBridge;
  if (typeof bridge?.bridgePayment !== 'function') throw new Error('Cross-chain Lightning needs the updated XBT LND engine.');
  return bridge;
};
const payload = (r: SwapRecord) => {
  if (!r.quote) throw new Error('Missing reviewed quote.');
  return JSON.stringify({
    invoice: r.quote.holdInvoice,
    hash: r.hash,
    msat: r.quote.payMsat,
    destination: r.quote.destination,
    feeLimit: r.feeLimit,
    expiresAt: r.quote.expiresAt,
    node: r.node,
  });
};
export const embeddedXbtBridgeBackend: BridgeBackend = {
  async identity() {
    return (await native().wallet('overview', '')).node;
  },
  async review(record) {
    return native().bridgePayment('review', payload(record));
  },
  async status(hash): Promise<NodePayment> {
    return native().bridgePayment('status', hash);
  },
  async pay(record): Promise<NodePayment> {
    try {
      return await native().bridgePayment('pay', payload(record));
    } catch (error) {
      if ((error as { code?: string }).code === 'payment_not_submitted_invalid_review') return { state: 'not_submitted' };
      throw error;
    }
  },
};
export const crossChainBridge = new BridgeController(bridgeStore, embeddedXbtBridgeBackend, lightningBridgeProviders);

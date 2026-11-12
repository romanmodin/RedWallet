import { TWallet, Transaction } from '../class/wallets/types';
import { WatchOnlyWallet } from '../class/wallets/watch-only-wallet';
import { XbtSegwitBech32Wallet } from '../class/wallets/xbt-segwit-bech32-wallet';
import { XbtTaprootWallet } from '../class/wallets/xbt-taproot-wallet';

export type XbtAccount = WatchOnlyWallet | XbtSegwitBech32Wallet | XbtTaprootWallet;
export type XbtAddressType = 'segwit' | 'taproot';
export type XbtAccountGroup = {
  id: string;
  label: string;
  receiveWalletID: string;
};

export function xbtAddressType(wallet: TWallet): XbtAddressType | undefined {
  if (wallet.type === XbtSegwitBech32Wallet.type) return 'segwit';
  if (wallet.type === XbtTaprootWallet.type) return 'taproot';
  if (wallet.type === WatchOnlyWallet.type && (wallet as WatchOnlyWallet).xbt_network) {
    const inner = (wallet as WatchOnlyWallet)._hdWalletInstance;
    if (inner instanceof XbtSegwitBech32Wallet) return 'segwit';
    if (inner instanceof XbtTaprootWallet) return 'taproot';
  }
}

export function isXbtAccount(wallet: TWallet): wallet is XbtAccount {
  return !!xbtAddressType(wallet);
}

function accountSuffix(wallet: XbtAccount): string | undefined {
  const path = wallet.getDerivationPath()?.replace(/h/g, "'");
  const purpose = xbtAddressType(wallet) === 'segwit' ? '84' : '86';
  const match = new RegExp('^m/' + purpose + "'/(0'/[0-9]+')$").exec(path ?? '');
  return match?.[1];
}

/** Fingerprints are a pairing hint, not proof of key ownership. Linking is always explicit. */
export function canGroupXbtAccounts(a: TWallet, b: TWallet): boolean {
  if (!isXbtAccount(a) || !isXbtAccount(b) || a.getID() === b.getID() || xbtAddressType(a) === xbtAddressType(b)) return false;
  if (!accountSuffix(a) || accountSuffix(a) !== accountSuffix(b)) return false;
  if (a instanceof WatchOnlyWallet || b instanceof WatchOnlyWallet) {
    return (
      a instanceof WatchOnlyWallet &&
      b instanceof WatchOnlyWallet &&
      a.getMasterFingerprint() !== 0 &&
      a.getMasterFingerprint() === b.getMasterFingerprint()
    );
  }
  return a.getSecret() === b.getSecret() && (a.getPassphrase() ?? '') === (b.getPassphrase() ?? '');
}

export function getXbtAccountMembers(wallet: TWallet, wallets: TWallet[]): XbtAccount[] {
  if (!isXbtAccount(wallet)) return [];
  const group = wallet.xbtAccountGroup;
  if (!group) return [wallet];
  const members = wallets.filter(w => isXbtAccount(w) && w.xbtAccountGroup?.id === group.id) as XbtAccount[];
  // Invalid or partially restored metadata must never hide an account.
  if (members.length !== 2 || !canGroupXbtAccounts(members[0], members[1])) return [wallet];
  return members;
}

export function linkXbtAccounts(a: XbtAccount, b: XbtAccount, label = a.getLabel()): void {
  if (!canGroupXbtAccounts(a, b)) throw new Error('These accounts cannot be grouped');
  const id = 'xbt-accounts:' + [a.getID(), b.getID()].sort().join(':');
  const group = {
    id,
    label: label.trim() || 'XBT wallet',
    receiveWalletID: (xbtAddressType(a) === 'taproot' ? a : b).getID(),
  };
  a.xbtAccountGroup = { ...group };
  b.xbtAccountGroup = { ...group };
}

export function getXbtReceiveAccount(wallet: TWallet, wallets: TWallet[]): TWallet {
  const members = getXbtAccountMembers(wallet, wallets);
  return members.find(w => w.getID() === wallet.xbtAccountGroup?.receiveWalletID) ?? wallet;
}

export function setXbtReceiveAccount(members: XbtAccount[], selectedID: string): void {
  if (!members.some(w => w.getID() === selectedID)) throw new Error('Import this account before selecting it');
  for (const member of members) {
    if (member.xbtAccountGroup)
      member.xbtAccountGroup = {
        ...member.xbtAccountGroup,
        receiveWalletID: selectedID,
      };
  }
}

/** Creates a sibling from an already-hot wallet only. Never changes the original derivation. */
export function createHotXbtSibling(wallet: XbtAccount): XbtSegwitBech32Wallet | XbtTaprootWallet {
  if (wallet instanceof WatchOnlyWallet) throw new Error('Import the other public account from your hardware wallet');
  const suffix = accountSuffix(wallet);
  if (!suffix || !wallet.validateMnemonic()) throw new Error('This wallet does not support automatic account creation');
  const sibling = xbtAddressType(wallet) === 'segwit' ? new XbtTaprootWallet() : new XbtSegwitBech32Wallet();
  sibling.setSecret(wallet.getSecret());
  const passphrase = wallet.getPassphrase();
  if (passphrase !== undefined) sibling.setPassphrase(passphrase);
  sibling.setDerivationPath('m/' + (xbtAddressType(sibling) === 'segwit' ? '84' : '86') + "'/" + suffix);
  sibling.setLabel(wallet.getLabel() + (xbtAddressType(sibling) === 'segwit' ? ' · SegWit' : ' · Taproot'));
  sibling.hideBalance = wallet.hideBalance;
  sibling.setHideTransactionsInWalletsList(wallet.getHideTransactionsInWalletsList());
  sibling.setPreferredBalanceUnit(wallet.getPreferredBalanceUnit());
  sibling.userHasSavedExport = wallet.userHasSavedExport;
  return sibling;
}

export type GroupTransaction = {
  hash: string;
  value: number;
  timestamp: number;
  internal: boolean;
  accounts: XbtAccount[];
};
export function groupXbtTransactions(members: XbtAccount[]): GroupTransaction[] {
  const rows = new Map<string, GroupTransaction & { positive: boolean; negative: boolean }>();
  for (const account of members) {
    const seen = new Set<string>();
    for (const tx of account.getTransactions() as Transaction[]) {
      const hash = tx.txid || tx.hash;
      if (!hash || seen.has(hash)) continue;
      seen.add(hash);
      const value = tx.value ?? 0;
      const row = rows.get(hash) ?? {
        hash,
        value: 0,
        timestamp: 0,
        internal: false,
        accounts: [],
        positive: false,
        negative: false,
      };
      row.value += value;
      row.timestamp = Math.max(row.timestamp, tx.timestamp || tx.time || 0);
      row.positive ||= value > 0;
      row.negative ||= value < 0;
      row.internal = row.positive && row.negative;
      row.accounts.push(account);
      rows.set(hash, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.timestamp - a.timestamp);
}

export type XbtGroupCard = {
  label: string;
  balance: number;
  hideBalance: boolean;
  latestTime: number;
  pending: boolean;
};
export function xbtGroupedCards(wallets: TWallet[]): {
  wallets: TWallet[];
  cards: Record<string, XbtGroupCard>;
} {
  const visible: TWallet[] = [];
  const cards: Record<string, XbtGroupCard> = {};
  const seen = new Set<string>();
  for (const wallet of wallets) {
    if (seen.has(wallet.getID())) continue;
    const members = getXbtAccountMembers(wallet, wallets);
    visible.push(wallet);
    if (members.length < 2) continue;
    members.forEach(w => seen.add(w.getID()));
    cards[wallet.getID()] = {
      label: wallet.xbtAccountGroup!.label,
      balance: members.reduce((sum, w) => sum + w.getBalance(), 0),
      hideBalance: members.some(w => w.hideBalance),
      latestTime: Math.max(...members.map(w => (w.getLatestTransactionTime() ? Date.parse(String(w.getLatestTransactionTime())) || 0 : 0))),
      pending: members.some(w => w.getTransactions().some((tx: Transaction) => tx.confirmations === 0)),
    };
  }
  return { wallets: visible, cards };
}

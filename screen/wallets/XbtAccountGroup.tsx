import React, { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useTheme } from '../../components/themes';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';
import { SettingsListItem } from '../../components/SettingsSection';
import XbtFiatEstimate from '../../components/XbtFiatEstimate';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import { formatWalletBalance, selectWalletNetwork } from '../../blue_modules/wallet-network';
import {
  canGroupXbtAccounts,
  createHotXbtSibling,
  getXbtAccountMembers,
  getXbtReceiveAccount,
  groupXbtTransactions,
  isXbtAccount,
  linkXbtAccounts,
  setXbtReceiveAccount,
  xbtAddressType,
  XbtAccount,
} from '../../blue_modules/xbt-account-groups';
import confirm from '../../helpers/confirm';
import { unlockWithBiometrics, useBiometrics } from '../../hooks/useBiometrics';
import loc from '../../loc';

export default function XbtAccountGroupScreen() {
  const { walletID, settings = false } = useRoute<RouteProp<DetailViewStackParamList, 'XbtAccountGroup'>>().params;
  const { wallets, saveToDisk, addWallet, deleteWallet, fetchAndSaveWalletTransactions } = useStorage();
  const navigation = useExtendedNavigation();
  const { isBiometricUseCapableAndEnabled } = useBiometrics();
  const { colors } = useTheme();
  const [showSettings, setShowSettings] = useState(settings);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const insets = useSafeAreaInsets();
  const wallet = wallets.find(w => w.getID() === walletID);
  const members = wallet ? getXbtAccountMembers(wallet, wallets) : [];
  const hideBalance = members.some(w => w.hideBalance);
  const balance = members.reduce((sum, w) => sum + w.getBalance(), 0);
  const label = wallet?.xbtAccountGroup?.label ?? wallet?.getLabel() ?? loc.xbt_accounts.wallet;
  const receive = wallet && getXbtReceiveAccount(wallet, wallets);
  const text = { color: colors.foregroundColor };
  const secondary = { color: colors.alternativeTextColor };
  const name = (w: XbtAccount) => (xbtAddressType(w) === 'taproot' ? 'Taproot' : 'SegWit');
  const amount = (sats: number) => (hideBalance ? '••••••' : formatWalletBalance(wallet, sats, BitcoinUnit.BTC, true));

  // Metadata writes are serialized and rolled back on persistence failure.
  const change = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    const before = wallets.map(w => ({
      wallet: w,
      group: w.xbtAccountGroup,
    }));
    try {
      await action();
    } catch (error) {
      before.forEach(saved => {
        saved.wallet.xbtAccountGroup = saved.group;
      });
      Alert.alert(loc.xbt_accounts.error_title, (error as Error).message);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const pair = async (other: XbtAccount, isNew = false) => {
    if (!wallet || !isXbtAccount(wallet)) return;
    if (!(await confirm(loc.xbt_accounts.pair_title, loc.xbt_accounts.pair_help))) return;
    if ((await isBiometricUseCapableAndEnabled()) && !(await unlockWithBiometrics())) return;
    if (!mounted.current) return;
    linkXbtAccounts(wallet, other);
    if (isNew) addWallet(other);
    try {
      await saveToDisk(false, true);
    } catch (error) {
      if (isNew) deleteWallet(other);
      throw error;
    }
    // Account creation is durable before discovery. A network failure does not remove the account.
    if (isNew)
      fetchAndSaveWalletTransactions(other.getID()).catch(() => {
        Alert.alert(loc.xbt_accounts.added, loc.xbt_accounts.refresh_failed);
      });
  };

  const openAccount = (account: XbtAccount) => {
    selectWalletNetwork(account);
    navigation.navigate('WalletTransactions', {
      walletID: account.getID(),
      walletType: account.type,
    });
  };
  const send = () =>
    Alert.alert(loc.xbt_accounts.send_from, loc.xbt_accounts.choose_funds, [
      ...members
        .filter(w => w.allowSend())
        .map(w => ({
          text: name(w) + ' · ' + amount(w.getBalance()),
          onPress: () => {
            selectWalletNetwork(w);
            navigation.navigate('SendDetailsRoot', {
              screen: 'SendDetails',
              params: { walletID: w.getID() },
            });
          },
        })),
      { text: loc._.cancel, style: 'cancel' },
    ]);
  const refresh = () =>
    change(async () => {
      for (const member of members) await fetchAndSaveWalletTransactions(member.getID());
    });
  if (!wallet || !isXbtAccount(wallet)) return <Text style={secondary}>{loc.xbt_accounts.unavailable}</Text>;
  const candidates = wallets.filter(w => !w.xbtAccountGroup && canGroupXbtAccounts(wallet, w)) as XbtAccount[];
  const transactions = hideBalance || members.some(w => w.getHideTransactionsInWalletsList()) ? [] : groupXbtTransactions(members);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <FlatList
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        data={showSettings ? [] : transactions}
        keyExtractor={item => item.hash}
        refreshing={busy}
        onRefresh={refresh}
        ListHeaderComponent={
          <>
            <Text style={[styles.title, text]}>{label}</Text>
            <Text style={[styles.balance, text]}>{amount(balance)}</Text>
            {!hideBalance && <XbtFiatEstimate satoshis={balance} />}
            <SettingsListItem
              title={showSettings ? loc.xbt_accounts.back : loc.xbt_accounts.settings}
              onPress={() => setShowSettings(!showSettings)}
            />
            {showSettings ? (
              <>
                <Text style={[styles.help, secondary]}>{loc.xbt_accounts.receive_help}</Text>
                {members.map(member => (
                  <SettingsListItem
                    key={member.getID()}
                    title={name(member)}
                    rightTitle={receive?.getID() === member.getID() ? loc.xbt_accounts.selected : ''}
                    disabled={busy}
                    testID={'ReceiveType-' + xbtAddressType(member)}
                    onPress={() =>
                      change(async () => {
                        setXbtReceiveAccount(members, member.getID());
                        await saveToDisk(false, true);
                      })
                    }
                  />
                ))}
                {members.length === 1 && (
                  <>
                    {candidates.map(candidate => (
                      <SettingsListItem
                        key={candidate.getID()}
                        title={loc.xbt_accounts.link + ' ' + name(candidate).toUpperCase()}
                        subtitle={candidate.getLabel()}
                        disabled={busy}
                        onPress={() => change(() => pair(candidate))}
                      />
                    ))}
                    {!(wallet instanceof WatchOnlyWallet) && candidates.length === 0 && (
                      <SettingsListItem
                        title={loc.xbt_accounts.add + ' ' + (xbtAddressType(wallet) === 'segwit' ? 'TAPROOT' : 'SEGWIT')}
                        disabled={busy}
                        onPress={() =>
                          change(async () => {
                            const sibling = createHotXbtSibling(wallet);
                            const existing = wallets.find(w => canGroupXbtAccounts(wallet, w));
                            if (existing) throw new Error(loc.xbt_accounts.exists);
                            await pair(sibling, true);
                          })
                        }
                      />
                    )}
                    {wallet instanceof WatchOnlyWallet && candidates.length === 0 && (
                      <Text style={[styles.help, secondary]}>{loc.xbt_accounts.import_help}</Text>
                    )}
                  </>
                )}
                {wallet.xbtAccountGroup && (
                  <SettingsListItem
                    title={loc.xbt_accounts.ungroup}
                    disabled={busy}
                    onPress={() =>
                      change(async () => {
                        if (!(await confirm(loc.xbt_accounts.ungroup_title, loc.xbt_accounts.ungroup_help))) return;
                        if (!mounted.current) return;
                        members.forEach(w => {
                          w.xbtAccountGroup = undefined;
                        });
                        await saveToDisk(false, true);
                      })
                    }
                  />
                )}
              </>
            ) : (
              <>
                <SettingsListItem title={loc.xbt_accounts.accounts + ' · ' + members.length} onPress={() => setExpanded(!expanded)} />
                {expanded &&
                  members.map(member => (
                    <SettingsListItem
                      key={member.getID()}
                      title={name(member)}
                      rightTitle={amount(member.getBalance())}
                      onPress={() => openAccount(member)}
                      chevron
                    />
                  ))}
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    style={styles.action}
                    onPress={() => {
                      if (receive) {
                        selectWalletNetwork(receive);
                        navigation.navigate('ReceiveDetails', {
                          walletID: receive.getID(),
                        });
                      }
                    }}
                  >
                    <Text style={text}>
                      {loc.xbt_accounts.receive} · {xbtAddressType(receive!) === 'taproot' ? 'TAPROOT' : 'SEGWIT'}
                    </Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" style={styles.action} disabled={!members.some(w => w.allowSend())} onPress={send}>
                    <Text style={members.some(w => w.allowSend()) ? text : secondary}>{loc.xbt_accounts.send}</Text>
                  </Pressable>
                </View>
                {!members.some(w => w.allowSend()) && <Text style={[styles.help, secondary]}>{loc.xbt_accounts.signer_help}</Text>}
                <Text style={[styles.heading, text]}>{loc.xbt_accounts.transactions}</Text>
              </>
            )}
          </>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            style={styles.transaction}
            onPress={() => {
              if (item.accounts.length === 1) openAccount(item.accounts[0]);
              else
                Alert.alert(loc.xbt_accounts.transaction_accounts, loc.xbt_accounts.transaction_help, [
                  ...item.accounts.map(w => ({
                    text: name(w),
                    onPress: () => openAccount(w),
                  })),
                  { text: loc._.cancel, style: 'cancel' },
                ]);
            }}
          >
            <View style={styles.row}>
              <Text style={text}>
                {item.internal ? loc.xbt_accounts.internal : item.value >= 0 ? loc.xbt_accounts.received : loc.xbt_accounts.sent}
              </Text>
              <Text style={text}>{amount(item.value)}</Text>
            </View>
            <Text style={secondary}>{item.timestamp ? new Date(item.timestamp * 1000).toLocaleString() : loc.xbt_accounts.pending}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  title: { fontSize: 22, fontWeight: '600', marginTop: 16 },
  balance: { fontSize: 28, fontWeight: 'bold', marginTop: 12 },
  help: { fontSize: 14, marginVertical: 12 },
  heading: { fontSize: 20, fontWeight: 'bold', marginVertical: 16 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  action: { paddingVertical: 18, paddingHorizontal: 8, minHeight: 48 },
  transaction: { paddingVertical: 16 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
});

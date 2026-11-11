import { isBtcWallet, formatWalletBalance } from '../blue_modules/wallet-network';
import React, { useMemo, useCallback, useRef } from 'react';
import { Alert, TouchableOpacity, Text, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useStorage } from '../hooks/context/useStorage';
import loc, { formatBalanceWithoutSuffix } from '../loc';
import { BitcoinUnit } from '../models/bitcoinUnits';
import ToolTipMenu from './TooltipMenu';
import { CommonToolTipActions } from '../typings/CommonToolTipActions';
import { useSettings } from '../hooks/context/useSettings';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTheme } from './themes';
import { formatLndAmount } from '../blue_modules/lnd-display-amount';
import { nextTotalBalanceDisplayMode, TotalBalanceDisplayMode } from '../blue_modules/total-balance-display';
import BtcUsdcEstimate from './BtcUsdcEstimate';
import XbtFiatEstimate from './XbtFiatEstimate';

export const TotalWalletsBalancePreferredUnit = 'TotalWalletsBalancePreferredUnit';
export const TotalWalletsBalanceKey = 'TotalWalletsBalance';

const TotalWalletsBalance: React.FC = React.memo(() => {
  const { wallets } = useStorage();
  const {
    preferredFiatCurrency,
    isTotalBalanceEnabled,
    totalBalanceDisplayMode,
    setTotalBalanceDisplayModeStorage,
    getTotalBalanceDisplayMode,
    xbtPriceQuote,
  } = useSettings();
  const masked = totalBalanceDisplayMode === 'hidden';
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const saving = useRef(false);
  const totalBalance = useMemo(
    () => wallets.reduce((prev, curr) => (curr.hideBalance || isBtcWallet(curr) ? prev : prev + (curr.getBalance() || 0)), 0),
    [wallets],
  );
  const btcWallets = wallets.filter(isBtcWallet);
  const btcTotal = btcWallets.reduce((sum, wallet) => sum + (wallet.hideBalance ? 0 : wallet.getBalance()), 0);
  const totalBalanceFormatted = useMemo(() => {
    if (masked) return '••••';
    if (totalBalanceDisplayMode === 'quote') return formatLndAmount(totalBalance, 'quote', xbtPriceQuote);
    return formatBalanceWithoutSuffix(totalBalance, totalBalanceDisplayMode === 'sats' ? BitcoinUnit.SATS : BitcoinUnit.BTC, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalBalance, totalBalanceDisplayMode, masked, preferredFiatCurrency, xbtPriceQuote]);
  const liveDisplay = useRef({ mode: totalBalanceDisplayMode, amount: totalBalanceFormatted });
  liveDisplay.current = { mode: totalBalanceDisplayMode, amount: totalBalanceFormatted };

  const changeDisplay = useCallback(
    async (next: TotalBalanceDisplayMode) => {
      if (saving.current) return;
      saving.current = true;
      try {
        await setTotalBalanceDisplayModeStorage(next);
      } catch {
        Alert.alert('Display not saved', 'Could not save your display preference. Please try again.');
      } finally {
        saving.current = false;
      }
    },
    [setTotalBalanceDisplayModeStorage],
  );

  const scaledStyles = useMemo(
    () => ({
      container: { paddingVertical: Math.round(8 * fontScale) },
      label: { lineHeight: Math.round(18 * fontScale), marginBottom: Math.round(2 * fontScale) },
      balance: { lineHeight: Math.round(38 * Math.max(1, fontScale)) },
    }),
    [fontScale],
  );
  const toolTipActions = useMemo(
    () => [
      {
        id: 'viewInActions',
        text: '',
        displayInline: true,
        subactions: [
          {
            ...CommonToolTipActions.ViewInFiat,
            text: loc.formatString(loc.total_balance_view.display_in_fiat, { currency: xbtPriceQuote?.currency ?? 'Exchange estimate' }),
            hidden: totalBalanceDisplayMode === 'quote',
          },
          { ...CommonToolTipActions.ViewInSats, hidden: totalBalanceDisplayMode === 'sats' },
          { ...CommonToolTipActions.ViewInBitcoin, text: loc.units.BTC, hidden: totalBalanceDisplayMode === 'XBT' },
        ],
      },
      ...(masked ? [] : [CommonToolTipActions.CopyAmount, CommonToolTipActions.Hide]),
    ],
    [xbtPriceQuote, totalBalanceDisplayMode, masked],
  );
  const onPressMenuItem = useCallback(
    async (id: string) => {
      switch (id) {
        case CommonToolTipActions.ViewInFiat.id:
          await changeDisplay('quote');
          break;
        case CommonToolTipActions.ViewInSats.id:
          await changeDisplay('sats');
          break;
        case CommonToolTipActions.ViewInBitcoin.id:
          await changeDisplay('XBT');
          break;
        case CommonToolTipActions.Hide.id:
          // Keep the total in place so a tap can reveal it again.
          await changeDisplay('hidden');
          break;
        case CommonToolTipActions.CopyAmount.id: {
          // Native menus can deliver an old callback after the preference changes.
          const current = getTotalBalanceDisplayMode();
          if (!saving.current && current !== 'hidden' && current === liveDisplay.current.mode) {
            Clipboard.setString(liveDisplay.current.amount.toString());
          }
          break;
        }
        default:
          break;
      }
    },
    [changeDisplay, getTotalBalanceDisplayMode],
  );
  const handleBalanceOnPress = useCallback(
    () => changeDisplay(nextTotalBalanceDisplayMode(getTotalBalanceDisplayMode())),
    [changeDisplay, getTotalBalanceDisplayMode],
  );
  if (!isTotalBalanceEnabled) return null;
  return (
    <ToolTipMenu actions={toolTipActions} onPressMenuItem={onPressMenuItem} shouldOpenOnLongPress style={styles.menuContainer}>
      <View style={[styles.container, scaledStyles.container]}>
        <Text style={[styles.label, scaledStyles.label]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {loc.wallets.total_balance}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Change total balance display"
          accessibilityHint="Cycles XBT, sats, the exchange-rate estimate, and hidden amounts. Tap hidden amounts to show XBT again."
          accessibilityValue={{
            text: masked
              ? 'Amounts hidden'
              : totalBalanceDisplayMode === 'quote'
                ? (xbtPriceQuote?.currency ?? 'Estimate')
                : totalBalanceDisplayMode,
          }}
          onPress={handleBalanceOnPress}
          style={styles.balanceTouchable}
        >
          <Text
            testID="TotalWalletsBalanceAmount"
            style={[styles.balance, scaledStyles.balance, { color: colors.foregroundColor }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.55}
          >
            {totalBalanceFormatted}
            {(totalBalanceDisplayMode === 'XBT' || totalBalanceDisplayMode === 'sats') && (
              <Text style={[styles.currency, { color: colors.foregroundColor }]}>
                {' ' + (totalBalanceDisplayMode === 'XBT' ? loc.units.BTC : 'sats')}
              </Text>
            )}
          </Text>
        </TouchableOpacity>
        {!masked && btcWallets.some(wallet => !wallet.hideBalance) && (
          <Text testID="TotalBtcBalance" style={{ color: colors.alternativeTextColor }}>
            {formatWalletBalance(btcWallets[0], btcTotal, BitcoinUnit.BTC, true)}
            <BtcUsdcEstimate satoshis={btcTotal} inline testID="TotalBtcUsdcEstimate" />
          </Text>
        )}
        {!masked && <XbtFiatEstimate satoshis={totalBalance} style={[styles.estimate, { color: colors.alternativeTextColor }]} />}
      </View>
    </ToolTipMenu>
  );
});

const styles = StyleSheet.create({
  menuContainer: {
    alignSelf: 'stretch',
  },
  container: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    width: '100%',
  },
  estimate: {
    marginTop: 4,
    fontSize: 13,
  },
  balanceTouchable: {
    alignSelf: 'stretch',
    width: '100%',
  },
  label: {
    fontSize: 14,
    marginBottom: 2,
    color: '#9BA0A9',
  },
  balance: {
    fontSize: 32,
    fontWeight: 'bold',
    lineHeight: 38,
  },
  currency: {
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default TotalWalletsBalance;

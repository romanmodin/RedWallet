import React, { useMemo, useCallback } from 'react';
import { TouchableOpacity, Text, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useStorage } from '../hooks/context/useStorage';
import loc, { formatBalanceWithoutSuffix } from '../loc';
import { BitcoinUnit } from '../models/bitcoinUnits';
import ToolTipMenu from './TooltipMenu';
import { CommonToolTipActions } from '../typings/CommonToolTipActions';
import { useSettings } from '../hooks/context/useSettings';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTheme } from './themes';
import { XBT_PROFILE } from '../class/xbt/profile';
import { normalizeXbtUnit, nextXbtUnit } from '../class/xbt/units';
import XbtFiatEstimate from './XbtFiatEstimate';

export const TotalWalletsBalancePreferredUnit = 'TotalWalletsBalancePreferredUnit';
export const TotalWalletsBalanceKey = 'TotalWalletsBalance';

const TotalWalletsBalance: React.FC = React.memo(() => {
  const { wallets } = useStorage();
  const {
    preferredFiatCurrency,
    isTotalBalanceEnabled,
    setIsTotalBalanceEnabledStorage,
    totalBalancePreferredUnit,
    setTotalBalancePreferredUnitStorage,
  } = useSettings();
  const displayUnit = normalizeXbtUnit(totalBalancePreferredUnit);
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();

  const totalBalance = useMemo(
    () => wallets.reduce((prev, curr) => (curr.hideBalance ? prev : prev + (curr.getBalance() || 0)), 0),
    [wallets],
  );
  const totalBalanceFormatted = useMemo(() => {
    return formatBalanceWithoutSuffix(totalBalance, totalBalancePreferredUnit, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalBalance, totalBalancePreferredUnit, preferredFiatCurrency]);

  const scaledStyles = useMemo(
    () => ({
      container: {
        paddingVertical: Math.round(8 * fontScale),
      },
      label: {
        lineHeight: Math.round(18 * fontScale),
        marginBottom: Math.round(2 * fontScale),
      },
      balance: {
        lineHeight: Math.round(38 * Math.max(1, fontScale)),
      },
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
            text: loc.formatString(loc.total_balance_view.display_in_fiat, { currency: preferredFiatCurrency.endPointKey }),
            hidden: !XBT_PROFILE.fiatEnabled || displayUnit === BitcoinUnit.LOCAL_CURRENCY,
          },
          { ...CommonToolTipActions.ViewInSats, hidden: displayUnit === BitcoinUnit.SATS },
          { ...CommonToolTipActions.ViewInBitcoin, text: loc.units.BTC, hidden: displayUnit === BitcoinUnit.BTC },
        ],
      },
      CommonToolTipActions.CopyAmount,
      CommonToolTipActions.Hide,
    ],
    [preferredFiatCurrency, displayUnit],
  );

  const onPressMenuItem = useCallback(
    async (id: string) => {
      switch (id) {
        case CommonToolTipActions.ViewInFiat.id:
          if (XBT_PROFILE.fiatEnabled) await setTotalBalancePreferredUnitStorage(BitcoinUnit.LOCAL_CURRENCY);
          break;
        case CommonToolTipActions.ViewInSats.id:
          await setTotalBalancePreferredUnitStorage(BitcoinUnit.SATS);
          break;
        case CommonToolTipActions.ViewInBitcoin.id:
          await setTotalBalancePreferredUnitStorage(BitcoinUnit.BTC);
          break;
        case CommonToolTipActions.Hide.id:
          await setIsTotalBalanceEnabledStorage(false);
          break;
        case CommonToolTipActions.CopyAmount.id:
          Clipboard.setString(totalBalanceFormatted.toString());
          break;
        default:
          break;
      }
    },
    [setIsTotalBalanceEnabledStorage, totalBalanceFormatted, setTotalBalancePreferredUnitStorage],
  );

  const handleBalanceOnPress = useCallback(async () => {
    const nextUnit = nextXbtUnit(totalBalancePreferredUnit);
    await setTotalBalancePreferredUnitStorage(nextUnit);
  }, [totalBalancePreferredUnit, setTotalBalancePreferredUnitStorage]);

  if (!isTotalBalanceEnabled) return null;

  return (
    <ToolTipMenu actions={toolTipActions} onPressMenuItem={onPressMenuItem} shouldOpenOnLongPress style={styles.menuContainer}>
      <View style={[styles.container, scaledStyles.container]}>
        <Text style={[styles.label, scaledStyles.label]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {loc.wallets.total_balance}
        </Text>
        <TouchableOpacity onPress={handleBalanceOnPress} style={styles.balanceTouchable}>
          <Text
            style={[styles.balance, scaledStyles.balance, { color: colors.foregroundColor }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.55}
          >
            {totalBalanceFormatted}
            {displayUnit !== BitcoinUnit.LOCAL_CURRENCY && (
              <Text
                style={[styles.currency, { color: colors.foregroundColor }]}
              >{` ${displayUnit === BitcoinUnit.BTC ? loc.units.BTC : displayUnit}`}</Text>
            )}
          </Text>
        </TouchableOpacity>
        <XbtFiatEstimate satoshis={totalBalance} style={[styles.estimate, { color: colors.alternativeTextColor }]} />
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

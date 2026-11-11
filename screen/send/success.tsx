import { XBT_PROFILE } from '../../class/xbt/profile';
import { dismissSendSuccess } from '../../helpers/dismiss-send-success';
import React, { useEffect } from 'react';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import BigNumber from 'bignumber.js';
import LottieView from 'lottie-react-native';
import { StyleSheet, Text, View } from 'react-native';
import BlueCard from '../../components/BlueCard';
import Button from '../../components/Button';
import SafeArea from '../../components/SafeArea';
import { useTheme } from '../../components/themes';
import loc from '../../loc';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import HandOffComponent from '../../components/HandOffComponent';
import { HandOffActivityType } from '../../components/types';
import { getTransactionExplorerUrl } from '../../models/blockExplorer';
import { SendDetailsStackParamList } from '../../navigation/SendDetailsStackParamList.ts';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

type RouteProps = RouteProp<SendDetailsStackParamList, 'Success'>;
type NavigationProps = NativeStackNavigationProp<SendDetailsStackParamList, 'Success'>;

const Success = () => {
  const { colors } = useTheme();
  const route = useRoute<RouteProps>();
  const navigation = useNavigation<NavigationProps>();
  const { amount, fee, amountUnit = BitcoinUnit.BTC, invoiceDescription = '', txid, assetTicker } = route.params || {};
  const explorerUrl = assetTicker === 'BTC' && txid ? `https://mempool.space/tx/${txid}` : getTransactionExplorerUrl(txid);
  const stylesHook = StyleSheet.create({
    root: {
      backgroundColor: colors.elevated,
    },
    amountValue: {
      color: colors.alternativeTextColor2,
    },
    amountUnit: {
      color: colors.alternativeTextColor2,
    },
  });

  const onDonePressed = () => {
    dismissSendSuccess(navigation);
  };

  useEffect(() => {
    console.log('send/success - useEffect');
  }, []);

  return (
    <SafeArea style={[styles.root, stylesHook.root]}>
      <SuccessView assetTicker={assetTicker} amount={amount} amountUnit={amountUnit} fee={fee} invoiceDescription={invoiceDescription} />
      <View style={styles.buttonContainer}>
        <Button testID="SendSuccessDone" onPress={onDonePressed} title={loc.send.success_done} />
      </View>
      {explorerUrl && (
        <HandOffComponent title={loc.transactions.details_title} type={HandOffActivityType.ViewInBlockExplorer} url={explorerUrl} />
      )}
    </SafeArea>
  );
};

export default Success;

interface SuccessViewParam {
  assetTicker?: 'BTC' | 'XBT';
  amount?: number;
  amountUnit?: BitcoinUnit;
  fee?: number;
  invoiceDescription?: string;
  shouldAnimate?: boolean;
}

export const SuccessView = ({ assetTicker, amount, amountUnit, fee, invoiceDescription, shouldAnimate = true }: SuccessViewParam) => {
  const { colors } = useTheme();
  // A persisted fiat number has no verified XBT value; keep the success state without that amount.
  const displayAmount = !XBT_PROFILE.fiatEnabled && amountUnit === BitcoinUnit.LOCAL_CURRENCY ? undefined : amount;

  let unit: string = '';
  switch (amountUnit) {
    case BitcoinUnit.BTC:
    case BitcoinUnit.SATS:
      unit = amountUnit === BitcoinUnit.BTC ? (assetTicker ?? loc.units.BTC) : loc.units[amountUnit];
      break;
  }

  const stylesHook = StyleSheet.create({
    amountValue: {
      color: colors.alternativeTextColor2,
    },
    amountUnit: {
      color: colors.alternativeTextColor2,
    },
  });

  return (
    <View style={styles.root}>
      {displayAmount || (fee ?? 0) > 0 ? (
        <BlueCard style={styles.amount}>
          <View style={styles.view}>
            {displayAmount ? (
              <>
                <Text style={[styles.amountValue, stylesHook.amountValue]}>{displayAmount}</Text>
                <Text style={[styles.amountUnit, stylesHook.amountUnit]}>{' ' + unit}</Text>
              </>
            ) : null}
          </View>
          {(fee ?? 0) > 0 && (
            <Text style={styles.feeText}>
              {loc.send.create_fee}: {new BigNumber(fee ?? 0).toFixed(8)} {assetTicker ?? loc.units.BTC}
            </Text>
          )}
          <Text numberOfLines={0} style={styles.feeText}>
            {invoiceDescription}
          </Text>
        </BlueCard>
      ) : null}

      <View style={styles.ready}>
        <LottieView
          style={styles.lottie}
          source={require('../../img/bluenice.json')}
          autoPlay={shouldAnimate}
          loop={false}
          progress={shouldAnimate ? 0 : 1}
          colorFilters={[
            {
              keypath: 'spark',
              color: colors.success,
            },
            {
              keypath: 'circle',
              color: colors.success,
            },
            {
              keypath: 'Oval',
              color: colors.successCheck,
            },
          ]}
          resizeMode="center"
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingTop: 19,
  },
  buttonContainer: {
    paddingHorizontal: 58,
    paddingBottom: 16,
  },
  amount: {
    alignItems: 'center',
  },
  view: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  amountValue: {
    fontSize: 36,
    fontWeight: '600',
  },
  amountUnit: {
    fontSize: 16,
    marginHorizontal: 4,
    paddingBottom: 6,
    fontWeight: '600',
    alignSelf: 'flex-end',
  },
  feeText: {
    color: '#37c0a1',
    fontSize: 14,
    marginHorizontal: 4,
    paddingVertical: 6,
    fontWeight: '500',
    alignSelf: 'center',
  },
  ready: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignSelf: 'center',
    alignItems: 'center',
    marginBottom: 53,
  },
  lottie: {
    width: 200,
    height: 200,
  },
});

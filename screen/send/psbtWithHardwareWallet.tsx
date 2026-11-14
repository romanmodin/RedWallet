import Clipboard from '@react-native-clipboard/clipboard';
import { RouteProp, StackActions, useIsFocused, useRoute } from '@react-navigation/native';
import * as bitcoin from 'bitcoinjs-lib';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { walletElectrum, isBtcWallet } from '../../blue_modules/wallet-network';
import { BtcWatchOnlyWallet } from '../../class/wallets/btc-watch-only-wallet';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import BlueCard from '../../components/BlueCard';
import BlueText from '../../components/BlueText';
import presentAlert from '../../components/Alert';
import CopyToClipboardButton from '../../components/CopyToClipboardButton';
import { DynamicQRCode } from '../../components/DynamicQRCode';
import SaveFileButton from '../../components/SaveFileButton';
import { SecondButton } from '../../components/SecondButton';
import { useTheme } from '../../components/themes';
import { useBiometrics, unlockWithBiometrics } from '../../hooks/useBiometrics';
import loc from '../../loc';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useSettings } from '../../hooks/context/useSettings';
import { majorTomToGroundControl } from '../../blue_modules/notifications';
import { openSignedTransactionRaw } from '../../blue_modules/fs';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import { SendDetailsStackParamList } from '../../navigation/SendDetailsStackParamList';
import confirm from '../../helpers/confirm';
import { requiresHighFeeApproval } from '../../class/xbt/fee-policy';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';

const PsbtWithHardwareWallet = () => {
  const { txMetadata, fetchAndSaveWalletTransactions, wallets } = useStorage();
  const { isElectrumDisabled } = useSettings();
  const { isBiometricUseCapableAndEnabled } = useBiometrics();
  const navigation = useExtendedNavigation();
  const route = useRoute<RouteProp<SendDetailsStackParamList, 'PsbtWithHardwareWallet'>>();
  const { walletID, memo, psbt, deepLinkPSBT, launchedBy } = route.params;
  const wallet = wallets.find(w => w.getID() === walletID) as WatchOnlyWallet;
  const routeParamsPSBT = useRef(route.params.psbt);
  const routeParamsTXHex = route.params.txhex;
  const { colors } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [txHex, setTxHex] = useState<string | undefined>(route.params.txhex);
  const openScannerButton = useRef<View | null>(null);
  const dynamicQRCode = useRef<DynamicQRCode | null>(null);
  const isFocused = useIsFocused();

  const stylesHook = StyleSheet.create({
    scrollViewContent: {
      backgroundColor: colors.elevated,
    },
    rootPadding: {
      backgroundColor: colors.elevated,
    },
    hexWrap: {
      backgroundColor: colors.elevated,
    },
    hexLabel: {
      color: colors.foregroundColor,
    },
    hexInput: {
      borderColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
      color: colors.foregroundColor,
    },
    hexText: {
      color: colors.foregroundColor,
    },
  });

  const _combinePSBT = useCallback(
    (receivedPSBT: bitcoin.Psbt | string): bitcoin.Transaction | undefined => {
      if (!psbt) {
        throw new Error('No PSBT to combine');
      }
      return wallet.combinePsbt(psbt, receivedPSBT);
    },
    [psbt, wallet],
  );

  const onBarScanned = useCallback(
    (ret: string | { data: string }) => {
      const data = typeof ret === 'string' ? ret : ret.data;
      if (data.toUpperCase().startsWith('UR')) {
        presentAlert({
          message: 'Finish scanning all QR fragments before importing the signature.',
        });
        return;
      }
      try {
        const trimmed = data.trim();
        const isHex = /^(?:[0-9a-fA-F]{2})+$/.test(trimmed);
        const received = isHex && trimmed.toLowerCase().startsWith('70736274ff') ? bitcoin.Psbt.fromHex(trimmed) : trimmed;
        const Tx =
          isHex && !trimmed.toLowerCase().startsWith('70736274ff')
            ? wallet instanceof BtcWatchOnlyWallet && psbt
              ? wallet.acceptSignedTransaction(trimmed, psbt)
              : undefined
            : _combinePSBT(received);
        if (!Tx) throw new Error('Scan a signed PSBT for the current transaction.');
        setTxHex(Tx?.toHex());
        if (launchedBy) {
          // we must navigate back to the screen who requested psbt (instead of broadcasting it ourselves)
          // most likely for LN channel opening
          const popToAction = StackActions.popTo(launchedBy, { psbt }, { merge: true });
          navigation.dispatch(popToAction);
          // ^^^ we just use `psbt` variable sinse it was finalized in the above _combinePSBT()
          // (passed by reference)
        }
      } catch (Err) {
        console.log('error in _combinePSBT():', Err);
        const message = Err instanceof Error ? Err.message : typeof Err === 'string' ? Err : 'Unknown error';
        presentAlert({ message });
      }
    },
    [_combinePSBT, launchedBy, navigation, psbt, wallet],
  );

  useEffect(() => {
    if (isFocused) {
      dynamicQRCode.current?.startAutoMove();
    } else {
      dynamicQRCode.current?.stopAutoMove();
    }
  }, [isFocused]);

  useEffect(() => {
    if (!psbt && !route.params.txhex) {
      presentAlert({ message: loc.send.no_tx_signing_in_progress });
    }

    if (deepLinkPSBT) {
      const newPsbt = bitcoin.Psbt.fromBase64(deepLinkPSBT);
      try {
        if (routeParamsPSBT.current) {
          const Tx = wallet.combinePsbt(routeParamsPSBT.current, newPsbt);
          setTxHex(Tx.toHex());
        }
      } catch (Err) {
        console.log('error in wallet.combinePsbt():', Err);
        const message = Err instanceof Error ? Err.message : typeof Err === 'string' ? Err : 'Unknown error';
        presentAlert({ message });
      }
    } else if (routeParamsTXHex) {
      setTxHex(routeParamsTXHex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkPSBT, routeParamsTXHex]);

  const broadcast = async () => {
    setIsLoading(true);
    const isBiometricsEnabled = await isBiometricUseCapableAndEnabled();

    if (isBiometricsEnabled) {
      if (!(await unlockWithBiometrics())) {
        setIsLoading(false);
        return;
      }
    }
    try {
      if (!txHex || !routeParamsPSBT.current) throw new Error('No reviewed signing request available');
      const reviewed =
        typeof routeParamsPSBT.current === 'string' ? bitcoin.Psbt.fromBase64(routeParamsPSBT.current) : routeParamsPSBT.current;
      const transaction = bitcoin.Transaction.fromHex(txHex);
      const inputValue = reviewed.data.inputs.reduce((sum, input) => {
        if (!input.witnessUtxo) throw new Error('Cannot verify transaction fee');
        return sum + input.witnessUtxo.value;
      }, 0n);
      const feeSats = Number(inputValue - transaction.outs.reduce((sum, output) => sum + output.value, 0n));
      const recipientValue = transaction.outs
        .filter(output => {
          try {
            return !wallet.weOwnAddress(bitcoin.address.fromOutputScript(output.script));
          } catch {
            return true;
          }
        })
        .reduce((sum, output) => sum + output.value, 0n);
      const amountSats = Number(recipientValue || transaction.outs.reduce((sum, output) => sum + output.value, 0n));
      const feeRate = feeSats / transaction.virtualSize();
      if (
        requiresHighFeeApproval({ feeSats, feeRate, amountSats }) &&
        !(await confirm(
          'High transaction fee',
          `The fee is ${feeSats} sats (${feeRate.toFixed(2)} sats/vB). Confirm this fee before sending.`,
        ))
      ) {
        setIsLoading(false);
        return;
      }
      if (wallet instanceof BtcWatchOnlyWallet) wallet.acceptSignedTransaction(txHex, reviewed);
      if (!(await walletElectrum(wallet).ensureConnected())) {
        throw new Error(loc.errors.network);
      }

      if (!txHex) {
        setIsLoading(false);
        presentAlert({ message: 'No transaction hex available' });
        return;
      }

      const result = await wallet.broadcastTx(txHex);
      if (result) {
        setIsLoading(false);
        const txDecoded = bitcoin.Transaction.fromHex(txHex);
        const txid = txDecoded.getId();
        majorTomToGroundControl([], [], [txid]);
        if (memo) {
          txMetadata[txid] = { memo };
        }
        navigation.navigate('Success', { amount: undefined });
        await new Promise(resolve => setTimeout(resolve, 3000)); // sleep to make sure network propagates
        fetchAndSaveWalletTransactions(wallet.getID());
      } else {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        setIsLoading(false);
        presentAlert({ message: loc.errors.broadcast });
      }
    } catch (error) {
      triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
      setIsLoading(false);
      console.log('error broadcasting:', error);
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
      presentAlert({ message });
    }
  };

  const handleOnVerifyPressed = () => {
    presentAlert({
      message: 'Transaction verification takes place on this device. Your transaction is not sent to a third-party website.',
    });
  };

  const copyHexToClipboard = () => {
    if (txHex) {
      Clipboard.setString(txHex);
    }
  };

  const _renderBroadcastHex = () => {
    return (
      <View style={[styles.rootPadding, stylesHook.rootPadding]}>
        <BlueCard style={[styles.hexWrap, stylesHook.hexWrap]}>
          {wallet instanceof BtcWatchOnlyWallet && routeParamsPSBT.current && (
            <BlueText testID="BtcSignedTransactionReview">{'Signature verified\n\n' + btcReview}</BlueText>
          )}
          <BlueText style={[styles.hexLabel, stylesHook.hexLabel]}>{loc.send.create_this_is_hex}</BlueText>
          <TextInput style={[styles.hexInput, stylesHook.hexInput]} multiline editable={false} value={txHex} />

          <TouchableOpacity accessibilityRole="button" style={styles.hexTouch} onPress={copyHexToClipboard}>
            <Text style={[styles.hexText, stylesHook.hexText]}>{loc.send.create_copy}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={styles.hexTouch} onPress={handleOnVerifyPressed}>
            <Text style={[styles.hexText, stylesHook.hexText]}>{loc.send.create_verify}</Text>
          </TouchableOpacity>
          <BlueSpacing20 />
          <SecondButton
            disabled={isLoading || (!isBtcWallet(wallet) && isElectrumDisabled)}
            onPress={broadcast}
            title={loc.send.confirm_sendNow}
            testID="PsbtWithHardwareWalletBroadcastTransactionButton"
          />
        </BlueCard>
      </View>
    );
  };

  const saveFileButtonBeforeOnPress = () => {
    dynamicQRCode.current?.stopAutoMove();
  };

  const saveFileButtonAfterOnPress = () => {
    dynamicQRCode.current?.startAutoMove();
  };

  const onOpenSignedTransaction = async () => {
    const file = await openSignedTransactionRaw();
    file && onBarScanned({ data: file });
  };

  useEffect(() => {
    const data = route.params.onBarScanned;
    if (data) {
      onBarScanned({ data });
      navigation.setParams({ onBarScanned: undefined });
    }
  }, [navigation, onBarScanned, route.params.onBarScanned]);

  const openScanner = async () => {
    navigation.navigate('ScanQRCode', {
      showFileImportButton: true,
    });
  };

  let btcReview = '';
  if (wallet instanceof BtcWatchOnlyWallet) {
    try {
      if (!routeParamsPSBT.current) throw new Error('No current signing request.');
      btcReview = wallet.getSigningReview(routeParamsPSBT.current);
      if (txHex) wallet.acceptSignedTransaction(txHex, routeParamsPSBT.current);
    } catch {
      return (
        <BlueCard>
          <BlueText>
            Signing session expired or the returned transaction could not be verified. Return to your wallet and review a new transaction.
          </BlueText>
          <SecondButton title="Return to wallet" onPress={() => navigation.goBack()} />
        </BlueCard>
      );
    }
  }

  if (txHex) {
    return (
      <ScrollView style={stylesHook.scrollViewContent} contentInsetAdjustmentBehavior="automatic">
        {_renderBroadcastHex()}
      </ScrollView>
    );
  }

  const renderView = isLoading ? (
    <ActivityIndicator />
  ) : (
    <View style={styles.container}>
      {wallet.type === WatchOnlyWallet.type && wallet.getHardwareSigningMode() === 'standard' && (
        <BlueCard>
          <BlueText>XBT · Standard hardware signing (0x01)</BlueText>
          <BlueText>
            Coin separation checked against Blockstream and mempool.space. Sending depends on those services agreeing on the SHA-256 chain.
            RedWallet checks again before broadcast. Your device produces a standard signature, not Unified protection.
          </BlueText>
        </BlueCard>
      )}
      <BlueCard>
        {wallet instanceof BtcWatchOnlyWallet && psbt && <BlueText testID="BtcHardwareTransactionReview">{btcReview}</BlueText>}
        <BlueText testID="TextHelperForPSBT">{loc.send.psbt_this_is_psbt}</BlueText>
        <BlueSpacing20 />
        <Text testID="PSBTHex" style={styles.hidden}>
          {psbt?.toHex()}
        </Text>
        {psbt && (
          <DynamicQRCode
            hideControls={false}
            value={psbt.toHex()}
            ref={dynamicQRCode}
            walletID={walletID}
            forceProtocol={wallet instanceof BtcWatchOnlyWallet ? 'URv2' : undefined}
          />
        )}
        <BlueSpacing20 />
        <SecondButton
          testID="PsbtTxScanButton"
          icon={{
            name: 'qrcode',
            type: 'font-awesome',
            color: colors.secondButtonTextColor,
          }}
          onPress={openScanner}
          ref={openScannerButton}
          title={loc.send.psbt_tx_scan}
        />
        <BlueSpacing20 />
        <SecondButton
          icon={{
            name: 'login',
            type: 'entypo',
            color: colors.secondButtonTextColor,
          }}
          onPress={onOpenSignedTransaction}
          title={loc.send.psbt_tx_open}
        />
        <BlueSpacing20 />
        {psbt && (
          <SaveFileButton
            fileName={`${Date.now()}.psbt`}
            fileContent={psbt.toBase64()}
            fileEncoding="base64"
            beforeOnPress={saveFileButtonBeforeOnPress}
            afterOnPress={saveFileButtonAfterOnPress}
          >
            <SecondButton
              icon={{
                name: 'share-alternative',
                type: 'entypo',
                color: colors.secondButtonTextColor,
              }}
              title={loc.send.psbt_tx_export}
            />
          </SaveFileButton>
        )}
        <BlueSpacing20 />
        {psbt && (
          <View style={styles.copyToClipboard}>
            <CopyToClipboardButton stringToCopy={typeof psbt === 'string' ? psbt : psbt.toBase64()} displayText={loc.send.psbt_clipboard} />
          </View>
        )}
      </BlueCard>
    </View>
  );

  return (
    <ScrollView
      centerContent
      style={stylesHook.scrollViewContent}
      automaticallyAdjustContentInsets
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.scrollViewContent, stylesHook.scrollViewContent]}
      testID="PsbtWithHardwareScrollView"
    >
      {renderView}
    </ScrollView>
  );
};

export default PsbtWithHardwareWallet;

const styles = StyleSheet.create({
  scrollViewContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingTop: 16,
    paddingBottom: 16,
  },
  rootPadding: {
    flex: 1,
    paddingTop: 20,
  },
  hexWrap: {
    alignItems: 'center',
    flex: 1,
    width: '100%',
  },
  hexLabel: {
    fontWeight: '500',
  },
  hexInput: {
    alignSelf: 'stretch',
    borderRadius: 4,
    marginTop: 20,
    maxHeight: 220,
    minHeight: 120,
    fontWeight: '500',
    fontSize: 14,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 16,
  },
  hexTouch: {
    marginVertical: 24,
  },
  hexText: {
    fontSize: 15,
    fontWeight: '500',
    alignSelf: 'center',
  },
  copyToClipboard: {
    marginVertical: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hidden: {
    width: 0,
    height: 0,
  },
});

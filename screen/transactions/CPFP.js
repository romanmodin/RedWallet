import * as bitcoin from 'bitcoinjs-lib';
import { unlockWithBiometrics } from '../../hooks/useBiometrics';
import confirm from '../../helpers/confirm';
import { requiresHighFeeApproval } from '../../class/xbt/fee-policy';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import { isXbtTaprootWallet, XbtTaprootTransaction } from '../../class/xbt-taproot-transaction';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import React, { Component } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import PropTypes from 'prop-types';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import BlueCard from '../../components/BlueCard';
import BlueText from '../../components/BlueText';
import { HDSegwitBech32Transaction } from '../../class/hd-segwit-bech32-transaction';
import { HDSegwitBech32Wallet } from '../../class/wallets/hd-segwit-bech32-wallet';
import presentAlert, { AlertType } from '../../components/Alert';
import Button from '../../components/Button';
import SafeArea from '../../components/SafeArea';
import { BlueCurrentTheme } from '../../components/themes';
import loc from '../../loc';
import { StorageContext } from '../../components/Context/StorageProvider';
import ReplaceFeeSuggestions from '../../components/ReplaceFeeSuggestions';
import { majorTomToGroundControl } from '../../blue_modules/notifications';
import { BlueSpacing, BlueSpacing20 } from '../../components/BlueSpacing';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingTop: 20,
  },
  explain: {
    paddingBottom: 16,
  },
  center: {
    alignItems: 'center',
    flex: 1,
  },
  hex: {
    color: BlueCurrentTheme.colors.buttonAlternativeTextColor,
    fontWeight: '500',
  },
  hexInput: {
    borderColor: '#ebebeb',
    backgroundColor: '#d2f8d6',
    borderRadius: 4,
    marginTop: 20,
    color: '#37c0a1',
    fontWeight: '500',
    fontSize: 14,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 16,
  },
  action: {
    marginVertical: 24,
  },
  actionText: {
    color: '#9aa0aa',
    fontSize: 15,
    fontWeight: '500',
    alignSelf: 'center',
  },
});

export default class CPFP extends Component {
  static contextType = StorageContext;
  constructor(props) {
    super(props);
    let txid;
    let wallet;
    if (props.route.params) txid = props.route.params.txid;
    if (props.route.params) wallet = props.route.params.wallet;

    this.state = {
      isLoading: true,
      stage: 1,
      txid,
      wallet,
      isElectrumDisabled: true,
    };
  }

  reviewFeeBump(result) {
    if (!isXbtTaprootWallet(this.state.wallet)) return;
    if (!result.tx) throw new Error('A signed fee bump is required');
    const recipients = result.tx.outs.filter(output => {
      try {
        return !this.state.wallet.addressIsChange(bitcoin.address.fromOutputScript(output.script));
      } catch {
        return true;
      }
    });
    const recipientValue = recipients.reduce((sum, output) => sum + output.value, 0n);
    const amountSats = Number(recipientValue || result.tx.outs.reduce((sum, output) => sum + output.value, 0n));
    const feeRate = result.fee / result.tx.virtualSize();
    const review = { feeSats: result.fee, feeRate, amountSats, hex: result.tx.toHex() };
    // Validate the numeric review even when the fee does not trigger a warning.
    requiresHighFeeApproval(review);
    this.feeReview = review;
    this.setState({ feeSats: result.fee, actualFeeRate: feeRate });
  }

  broadcast = () => {
    this.setState({ isLoading: true }, async () => {
      try {
        if (isXbtTaprootWallet(this.state.wallet)) {
          if ((await this.context.getItem('Biometrics')) && !(await unlockWithBiometrics())) {
            this.setState({ isLoading: false });
            return;
          }
          const review = this.feeReview;
          if (!review || review.hex !== this.state.txhex) throw new Error('No reviewed fee bump available');
          if (
            requiresHighFeeApproval(review) &&
            !(await confirm(
              'High transaction fee',
              `The fee is ${review.feeSats} sats (${review.feeRate.toFixed(2)} sats/vB). Confirm this fee before sending.`,
            ))
          ) {
            this.setState({ isLoading: false });
            return;
          }
        }
        if (!(await BlueElectrum.ensureConnected())) {
          throw new Error(loc.errors.network);
        }
        const result = await this.state.wallet.broadcastTx(this.state.txhex);
        if (result) {
          this.onSuccessBroadcast();
        } else {
          triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
          this.setState({ isLoading: false });
          presentAlert({ message: loc.errors.broadcast });
        }
      } catch (error) {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        this.setState({ isLoading: false });
        presentAlert({ message: error.message, type: AlertType.Toast });
      }
    });
  };

  onSuccessBroadcast() {
    this.context.txMetadata[this.state.newTxid] = {
      memo: 'Child pays for parent (CPFP)',
    };
    majorTomToGroundControl([], [], [this.state.newTxid]);
    this.context.sleep(4000).then(() => this.context.fetchAndSaveWalletTransactions(this.state.wallet.getID()));
    this.props.navigation.navigate('Success', { amount: undefined });
  }

  async componentDidMount() {
    console.log('transactions/CPFP - componentDidMount');
    this.setState({
      isLoading: true,
      newFeeRate: '',
      nonReplaceable: false,
    });
    try {
      await this.checkPossibilityOfCPFP();
    } catch (_) {
      // if anything goes wrong we just show "this is not bumpable" message
      this.setState({ nonReplaceable: true, isLoading: false });
    }
  }

  async checkPossibilityOfCPFP() {
    if (
      !isXbtTaprootWallet(this.state.wallet) &&
      this.state.wallet.type !== HDSegwitBech32Wallet.type &&
      this.state.wallet.type !== XbtSegwitBech32Wallet.type
    ) {
      return this.setState({ nonReplaceable: true, isLoading: false });
    }
    const tx = isXbtTaprootWallet(this.state.wallet)
      ? new XbtTaprootTransaction(null, this.state.txid, this.state.wallet)
      : new HDSegwitBech32Transaction(null, this.state.txid, this.state.wallet);
    if ((await tx.isToUsTransaction()) && (await tx.getRemoteConfirmationsNum()) === 0) {
      const info = await tx.getInfo();
      return this.setState({
        nonReplaceable: false,
        feeRate: info.feeRate + 1,
        isLoading: false,
        tx,
      });
      // 1 sat makes a lot of difference, since sometimes because of rounding created tx's fee might be insufficient
    } else {
      return this.setState({ nonReplaceable: true, isLoading: false });
    }
  }

  async createTransaction() {
    const newFeeRate = parseInt(this.state.newFeeRate, 10);
    if (newFeeRate > this.state.feeRate) {
      /** @type {HDSegwitBech32Transaction} */
      const tx = this.state.tx;
      this.setState({ isLoading: true });
      try {
        const result = await tx.createCPFPbumpFee(newFeeRate);
        const { tx: newTx, psbt } = result;
        if (this.state.wallet instanceof WatchOnlyWallet) {
          this.props.navigation
            .getParent()
            ?.getParent()
            ?.navigate('SendDetailsRoot', {
              screen: 'PsbtWithHardwareWallet',
              params: {
                memo: 'Child pays for parent (CPFP)',
                walletID: this.state.wallet.getID(),
                psbt,
              },
            });
          this.setState({ isLoading: false });
          return;
        }
        this.setState({
          stage: 2,
          txhex: newTx.toHex(),
          newTxid: newTx.getId(),
        });
        this.setState({ isLoading: false });
      } catch (_) {
        this.setState({ isLoading: false });
        presentAlert({ message: loc.errors.error + ': ' + _.message });
      }
    }
  }

  renderStage1(text) {
    return (
      <SafeArea style={styles.root}>
        <BlueSpacing />
        <BlueCard style={styles.center}>
          <BlueText>{text}</BlueText>
          <BlueSpacing20 />
          <ReplaceFeeSuggestions onFeeSelected={fee => this.setState({ newFeeRate: fee })} transactionMinimum={this.state.feeRate} />
          <BlueSpacing />
          <Button
            disabled={this.state.newFeeRate <= this.state.feeRate}
            onPress={() => this.createTransaction()}
            title={loc.transactions.cpfp_create}
          />
        </BlueCard>
      </SafeArea>
    );
  }

  renderStage2() {
    return (
      <View style={styles.root}>
        <BlueCard style={styles.center}>
          {this.state.feeSats !== undefined && (
            <BlueText>{`Fee: ${this.state.feeSats} sats (${this.state.actualFeeRate.toFixed(2)} sats/vB)`}</BlueText>
          )}
          <BlueText style={styles.hex}>{loc.send.create_this_is_hex}</BlueText>
          <TextInput style={styles.hexInput} height={112} multiline editable value={this.state.txhex} />

          <TouchableOpacity accessibilityRole="button" style={styles.action} onPress={() => Clipboard.setString(this.state.txhex)}>
            <Text style={styles.actionText}>{loc.send.create_copy}</Text>
          </TouchableOpacity>
          <Button disabled={this.context.isElectrumDisabled} onPress={this.broadcast} title={loc.send.confirm_sendNow} />
        </BlueCard>
      </View>
    );
  }

  render() {
    if (this.state.isLoading) {
      return (
        <View style={styles.root}>
          <ActivityIndicator />
        </View>
      );
    }

    if (this.state.stage === 2) {
      return this.renderStage2();
    }

    if (this.state.nonReplaceable) {
      return (
        <SafeArea style={styles.root}>
          <BlueSpacing20 />
          <BlueSpacing20 />
          <BlueSpacing20 />
          <BlueSpacing20 />
          <BlueSpacing20 />

          <BlueText h4>{loc.transactions.cpfp_no_bump}</BlueText>
        </SafeArea>
      );
    }

    return (
      <SafeArea style={styles.explain}>
        <ScrollView
          automaticallyAdjustContentInsets
          automaticallyAdjustKeyboardInsets
          automaticallyAdjustsScrollIndicatorInsets
          contentInsetAdjustmentBehavior="automatic"
        >
          {this.renderStage1(loc.transactions.cpfp_exp)}
        </ScrollView>
      </SafeArea>
    );
  }
}

CPFP.propTypes = {
  navigation: PropTypes.shape({
    popToTop: PropTypes.func,
    getParent: PropTypes.func,
    navigate: PropTypes.func,
  }),
  route: PropTypes.shape({
    params: PropTypes.shape({
      txid: PropTypes.string,
      wallet: PropTypes.object,
    }),
  }),
};

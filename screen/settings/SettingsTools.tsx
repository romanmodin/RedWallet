import React from 'react';
import { NativeModules, StyleSheet } from 'react-native';
import { useStorage } from '../../hooks/context/useStorage';
import { isBtcWallet } from '../../blue_modules/wallet-network';
import presentAlert from '../../components/Alert';
import type { TWallet } from '../../class/wallets/types';
import { useTheme } from '../../components/themes';

import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import { SettingsSection, SettingsListItem, SettingsScrollView } from '../../components/SettingsSection';

const SettingsTools: React.FC = () => {
  const navigation = useExtendedNavigation();
  const { dark } = useTheme();
  const navigateToIsItMyAddress = () => {
    navigation.navigate('IsItMyAddress');
  };

  const navigateToBroadcast = () => {
    navigation.navigate('Broadcast');
  };

  const { wallets } = useStorage();
  const openSha256Broadcast = () => {
    const availableWallets = wallets.filter(isBtcWallet);
    if (!availableWallets.length) {
      presentAlert({ message: loc.send.broadcast_sha256_wallet });
      return;
    }
    const open = (wallet: TWallet) => navigation.navigate('Sha256Broadcast', { walletID: wallet.getID() });
    if (availableWallets.length === 1) {
      open(availableWallets[0]);
      return;
    }
    navigation.navigate('SelectWallet', {
      availableWallets,
      onWalletSelect: (wallet: TWallet) => {
        navigation.goBack();
        open(wallet);
      },
    });
  };

  const navigateToGenerateWord = () => {
    navigation.navigate('GenerateWord');
  };

  return (
    <SettingsScrollView testID="SettingsToolsRoot">
      <SettingsSection>
        <SettingsListItem
          title={loc.hardware_check.title}
          subtitle={loc.hardware_check.subtitle}
          iconName="key"
          onPress={() => navigation.navigate('HardwareSigningCheck')}
          testID="HardwareSigningCheckTool"
          chevron
        />
        {!!NativeModules.XBTLightningBridge && (
          <SettingsListItem
            title="XBT Lightning"
            testID="XBTLightningSettingsTool"
            iconName="lightning"
            subtitle="On-device test node · Regtest"
            onPress={() => navigation.navigate('XBTLightning')}
            chevron
          />
        )}
        <SettingsListItem
          title="CoinJoin — Experimental"
          subtitle="Opt-in mixing · Still in testing"
          titleStyle={dark ? styles.experimentalDark : styles.experimentalLight}
          containerStyle={styles.experimentalRow}
          iconName="tools"
          onPress={() => navigation.navigate('CoinjoinExperimental')}
          testID="CoinjoinExperimental"
          chevron
        />
        <SettingsListItem
          title={loc.is_it_my_address.title}
          iconName="search"
          onPress={navigateToIsItMyAddress}
          testID="IsItMyAddress"
          chevron
        />
        <SettingsListItem title={loc.send.broadcast_xbt} iconName="paperPlane" onPress={navigateToBroadcast} testID="Broadcast" chevron />
        <SettingsListItem
          title={loc.send.broadcast_sha256}
          iconName="paperPlane"
          onPress={openSha256Broadcast}
          testID="Sha256Broadcast"
          chevron
        />
        <SettingsListItem
          title={loc.autofill_word.title}
          iconName="key"
          onPress={navigateToGenerateWord}
          testID="GenerateWord"
          chevron
          bottomDivider={false}
        />
      </SettingsSection>
    </SettingsScrollView>
  );
};

const styles = StyleSheet.create({
  experimentalDark: { color: '#D9A53A' },
  experimentalLight: { color: '#805500' },
  experimentalRow: { borderLeftWidth: 3, borderLeftColor: '#D9A53A' },
});
export default SettingsTools;

import React, { useMemo, useLayoutEffect, useCallback, useState } from 'react';
import { View, StyleSheet, Linking, Image } from 'react-native';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import { SettingsSection, SettingsListItem, SettingsScrollView, SettingsFootnote } from '../../components/SettingsSection';
import { useSettings } from '../../hooks/context/useSettings';
import CopyTextToClipboard from '../../components/CopyTextToClipboard';
import QRCode from '../../components/QRCode';
import { XBT_PROFILE } from '../../class/xbt/profile';

const REDWALLET_DONATION_ADDRESS = 'bc1q86uhqahctvu7ygjenrcpp9c6dmxu6s8wzktfd4';

const Settings = () => {
  const [showDonationAddress, setShowDonationAddress] = useState(false);
  const { navigate, setOptions } = useExtendedNavigation();
  const { language } = useSettings(); // Subscribe to language changes to trigger re-render
  useLayoutEffect(() => {
    // Only the title needs refreshing on language change; header styling comes from the route options
    setOptions({ title: loc.settings.header });
  }, [setOptions, language]);

  const handleDonatePress = useCallback(() => {
    Linking.openURL('https://donate.bluewallet.io/');
  }, []);

  const donateIcon = useMemo(
    () => (
      <View style={styles.donateIconContainer}>
        <Image source={require('../../img/bluebeast.png')} style={styles.donateIconImage} resizeMode="contain" />
      </View>
    ),
    [],
  );

  return (
    <SettingsScrollView testID="SettingsRoot">
      <SettingsSection>
        <SettingsListItem
          title={loc.settings.donate}
          subtitle={loc.settings.donate_description}
          subtitleNumberOfLines={0}
          leftAvatar={donateIcon}
          onPress={handleDonatePress}
          testID="Donate"
          bottomDivider={false}
        />
      </SettingsSection>

      <SettingsSection>
        <SettingsListItem
          title="Support RedWallet"
          subtitle="RedWallet is free. Voluntary XBT donations help cover development and testing."
          subtitleNumberOfLines={0}
          iconName="currency"
          onPress={() => setShowDonationAddress(value => !value)}
          testID="RedWalletDonate"
          accessibilityRole="button"
          accessibilityState={{ expanded: showDonationAddress }}
          bottomDivider={false}
        />
        {showDonationAddress && (
          <View style={styles.redWalletDonation} testID="RedWalletDonationDetails">
            <SettingsFootnote>XBT (BLAKE2b) only. Scan the QR code or tap the address to copy it.</SettingsFootnote>
            <View style={styles.donationQr}>
              <QRCode value={REDWALLET_DONATION_ADDRESS} size={200} isLogoRendered={false} isMenuAvailable={false} />
            </View>
            <CopyTextToClipboard
              text={REDWALLET_DONATION_ADDRESS}
              isAddress
              buttonTestID="CopyRedWalletDonationAddress"
              textTestID="RedWalletDonationAddress"
            />
          </View>
        )}
      </SettingsSection>

      <SettingsSection>
        <SettingsListItem
          title={loc.settings.general}
          iconName="settings"
          onPress={() => navigate('GeneralSettings')}
          testID="GeneralSettings"
          chevron
        />
        <SettingsListItem title="XBT price" iconName="currency" onPress={() => navigate('XbtPrice')} testID="XbtPriceSettings" chevron />
        {XBT_PROFILE.fiatEnabled && (
          <SettingsListItem
            title={loc.settings.currency}
            iconName="currency"
            onPress={() => navigate('Currency')}
            testID="Currency"
            chevron
          />
        )}
        <SettingsListItem
          title={loc.settings.language}
          iconName="language"
          onPress={() => navigate('Language')}
          testID="Language"
          chevron
        />
        <SettingsListItem
          title={loc.settings.encrypt_title}
          iconName="security"
          onPress={() => navigate('EncryptStorage')}
          testID="SecurityButton"
          chevron
        />
        <SettingsListItem
          title={loc.settings.network}
          iconName="network"
          onPress={() => navigate('NetworkSettings')}
          testID="NetworkSettings"
          chevron
          bottomDivider={false}
        />
      </SettingsSection>

      <SettingsSection>
        <SettingsListItem
          title={loc.settings.tools}
          iconName="tools"
          onPress={() => navigate('SettingsTools')}
          testID="Tools"
          chevron
          bottomDivider={false}
        />
      </SettingsSection>

      <SettingsSection>
        <SettingsListItem
          title={loc.settings.about}
          iconName="about"
          onPress={() => navigate('About')}
          testID="AboutButton"
          chevron
          bottomDivider={false}
        />
      </SettingsSection>
    </SettingsScrollView>
  );
};

export default Settings;

const styles = StyleSheet.create({
  redWalletDonation: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    alignItems: 'center',
  },
  donationQr: {
    marginVertical: 16,
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  donateIconContainer: {
    padding: 4,
  },
  donateIconImage: {
    width: 48,
    height: 48,
  },
});

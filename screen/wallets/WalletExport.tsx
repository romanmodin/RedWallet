import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Clipboard from '@react-native-clipboard/clipboard';
import { copySensitiveClipboard, clearSensitiveClipboard } from '../../blue_modules/sensitive-clipboard';
import { useSecretExport } from '../../hooks/useSecretExport';
import presentAlert from '../../components/Alert';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import Icon from '../../components/Icon';
import { ActivityIndicator, LayoutChangeEvent, ScrollView, StyleSheet, Pressable, View } from 'react-native';
import { useScreenProtect } from '../../hooks/useScreenProtect';
import { validateMnemonic } from '../../blue_modules/bip39';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import BlueText from '../../components/BlueText';
import { LightningCustodianWallet } from '../../class/wallets/lightning-custodian-wallet';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import HandOffComponent from '../../components/HandOffComponent';
import QRCode from '../../components/QRCode';
import SeedWords from '../../components/SeedWords';
import { useTheme } from '../../components/themes';
import { HandOffActivityType } from '../../components/types';
import { useSettings } from '../../hooks/context/useSettings';
import { useStorage } from '../../hooks/context/useStorage';
import useAppState from '../../hooks/useAppState';
import loc from '../../loc';
import { WalletExportStackParamList } from '../../navigation/WalletExportStack';
import { WalletDescriptor } from '../../class/wallet-descriptor.ts';

type RouteProps = RouteProp<WalletExportStackParamList, 'WalletExport'>;

const HORIZONTAL_PADDING = 20;

const CopyBox: React.FC<{
  text: string;
  copied: boolean;
  onPress: () => void;
}> = ({ text, copied, onPress }) => {
  const { colors } = useTheme();
  const stylesHook = StyleSheet.create({
    copyRoot: { backgroundColor: colors.lightBorder },
  });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={copied ? loc._.copied : loc.transactions.details_copy}
      testID="WalletExportCopy"
      style={({ pressed }) => [pressed && styles.pressed, styles.copyRoot, stylesHook.copyRoot]}
    >
      <View style={styles.copyLeft}>
        <BlueText textBreakStrategy="balanced" style={styles.copyText}>
          {copied ? loc._.copied : text}
        </BlueText>
      </View>
      <View style={styles.copyRight}>
        <Icon name={copied ? 'check' : 'copy'} type="font-awesome-6" color={colors.foregroundColor} />
      </View>
    </Pressable>
  );
};

const DoNotDisclose: React.FC = () => {
  const { colors } = useTheme();

  return (
    <View style={[styles.warningBox, { backgroundColor: colors.changeText }]}>
      <Icon type="font-awesome-6" name="circle-exclamation" size={24} color="white" />
      <BlueText style={styles.warning}>{loc.wallets.warning_do_not_disclose}</BlueText>
    </View>
  );
};

const WalletExport: React.FC = () => {
  const { wallets } = useStorage();
  const { walletID } = useRoute<RouteProps>().params;
  const navigation = useNavigation();
  const { isPrivacyBlurEnabled } = useSettings();
  const { colors } = useTheme();
  const wallet = wallets.find(w => w.getID() === walletID)!;
  const authorizeSecretExport = useSecretExport();
  const isPublicExport = wallet instanceof WatchOnlyWallet;
  const fingerprint = isPublicExport && wallet.hasMasterFingerprint() ? wallet.getMasterFingerprintHex() : undefined;
  const [authorized, setAuthorized] = useState(isPublicExport);
  const [copied, setCopied] = useState(false);
  const [qrCodeSize, setQRCodeSize] = useState(90);
  const { enableScreenProtect, disableScreenProtect } = useScreenProtect();
  const { currentAppState, previousAppState } = useAppState();
  const stylesHook = StyleSheet.create({
    root: { backgroundColor: colors.elevated },
  });

  const secrets: string[] = useMemo(() => {
    if (!authorized) return [];
    try {
      let secret = wallet.getSecret();
      if (wallet instanceof WatchOnlyWallet) {
        try {
          const path = wallet.getDerivationPath();
          if (path?.startsWith('m/86')) {
            // for taproot watch-only HD we dont just show xpub, we show wallet descriptor
            secret = WalletDescriptor.getDescriptor(fingerprint ?? '00000000', path, secret);
          } else if (fingerprint && path?.startsWith("m/84'") && wallet.isHd()) {
            const xpub = secret.startsWith('zpub') ? wallet._zpubToXpub(secret) : secret;
            secret = WalletDescriptor.getDescriptor(fingerprint, path, xpub);
          }
        } catch (e: any) {
          console.log(e.message);
        }
      }
      return typeof secret === 'string' ? [secret] : Array.isArray(secret) ? secret : [];
    } catch (error) {
      console.error('Failed to get wallet secret:', error);
      return [];
    }
  }, [wallet, authorized, fingerprint]);

  useEffect(() => {
    let active = true;
    if (!(wallet instanceof WatchOnlyWallet)) {
      authorizeSecretExport().then(ok => {
        if (!active) return;
        if (ok) setAuthorized(true);
        else navigation.goBack();
      });
    }
    return () => {
      active = false;
    };
  }, [authorizeSecretExport, navigation, wallet]);

  const secretIsMnemonic: boolean = useMemo(() => {
    return validateMnemonic(wallet.getSecret());
  }, [wallet]);

  useEffect(() => {
    if (!isPublicExport && authorized && previousAppState === 'active' && currentAppState !== 'active') {
      setAuthorized(false);
      clearSensitiveClipboard().catch(() => {});
      disableScreenProtect();
      const timer = setTimeout(() => {
        navigation.goBack();
      }, 500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAppState, previousAppState, isPublicExport]);

  useEffect(() => {
    if (isPrivacyBlurEnabled) {
      enableScreenProtect();
    }
    return () => {
      disableScreenProtect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPrivacyBlurEnabled]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { height, width } = e.nativeEvent.layout;

    const isPortrait = height > width;
    const maxQRSize = 400;

    if (isPortrait) {
      const heightBasedSize = Math.min(height * 0.5, maxQRSize);
      const widthBasedSize = width * 0.75 - HORIZONTAL_PADDING * 2;
      setQRCodeSize(Math.min(heightBasedSize, widthBasedSize));
    } else {
      const heightBasedSize = Math.min(height * 0.6, maxQRSize);
      const widthBasedSize = width * 0.35;
      setQRCodeSize(Math.min(heightBasedSize, widthBasedSize));
    }
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = useCallback(() => {
    // Private exports have already been authenticated for this foreground session.
    if (!authorized || !secrets[0]) return;
    try {
      if (isPublicExport) Clipboard.setString(secrets[0]);
      else copySensitiveClipboard(secrets[0]);
      setCopied(true);
      triggerHapticFeedback(HapticFeedbackTypes.Selection);
    } catch {
      presentAlert({
        message: isPublicExport ? 'Could not copy the public wallet export.' : 'Secure clipboard copying is unavailable in this build',
      });
    }
  }, [secrets, authorized, isPublicExport]);

  const Scroll = useCallback(
    // eslint-disable-next-line react/no-unused-prop-types
    ({ children }: { children: React.ReactNode | React.ReactNode[] }) => (
      <ScrollView
        automaticallyAdjustContentInsets
        contentInsetAdjustmentBehavior="automatic"
        style={stylesHook.root}
        contentContainerStyle={styles.scrollViewContent}
        onLayout={onLayout}
        testID="WalletExportScroll"
      >
        {children}
      </ScrollView>
    ),
    [onLayout, stylesHook.root],
  );

  if (!authorized) return <ActivityIndicator accessibilityLabel="Authenticating wallet export" />;

  // for SLIP39
  if (secrets.length !== 1) {
    return (
      <Scroll>
        <DoNotDisclose />

        <View>
          <BlueText style={styles.manualText}>{loc.wallets.write_down_header}</BlueText>
          <BlueText style={styles.writeText}>{loc.wallets.write_down}</BlueText>
        </View>

        {secrets.map((secret, index) => (
          <React.Fragment key={secret}>
            <BlueText style={styles.scanText}>
              {loc.formatString(loc.wallets.share_number, {
                number: index + 1,
              })}
            </BlueText>
            <SeedWords seed={secret} />
          </React.Fragment>
        ))}

        <BlueText style={styles.typeText}>
          {loc.formatString(loc.wallets.wallet_type_this, {
            type: wallet.typeReadable,
          })}
        </BlueText>
      </Scroll>
    );
  }

  const secret = secrets[0];

  return (
    <ScrollView
      automaticallyAdjustContentInsets
      contentInsetAdjustmentBehavior="automatic"
      style={stylesHook.root}
      contentContainerStyle={styles.scrollViewContent}
      onLayout={onLayout}
      testID="WalletExportScroll"
    >
      {!(wallet instanceof WatchOnlyWallet) && <DoNotDisclose />}

      <BlueText style={styles.scanText}>{loc.wallets.scan_import}</BlueText>

      <View style={styles.qrCodeContainer}>
        <QRCode isMenuAvailable={false} value={secret} size={qrCodeSize} logoSize={70} />
      </View>

      {/* Do not allow to copy mnemonic */}
      {secretIsMnemonic ? (
        <>
          <View>
            <BlueText style={styles.manualText}>{loc.wallets.write_down_header}</BlueText>
            <BlueText style={styles.writeText}>{loc.wallets.write_down}</BlueText>
          </View>
          <SeedWords seed={secret} />
        </>
      ) : (
        <>
          <BlueText style={styles.writeText}>
            {wallet.type === LightningCustodianWallet.type ? loc.wallets.copy_ln_url : loc.wallets.copy_ln_public}
          </BlueText>
          <CopyBox text={secret} copied={copied} onPress={handleCopy} />
        </>
      )}

      {wallet instanceof WatchOnlyWallet && (
        <HandOffComponent title={loc.wallets.xpub_title} type={HandOffActivityType.Xpub} userInfo={{ xpub: secret }} />
      )}

      <BlueText style={styles.typeText}>
        {loc.formatString(loc.wallets.wallet_type_this, {
          type: wallet.typeReadable,
        })}
      </BlueText>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollViewContent: {
    justifyContent: 'center',
    flexGrow: 1,
    gap: 32,
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 10,
    paddingBottom: 20,
  },
  warningBox: {
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 8,
  },
  warning: {
    fontSize: 20,
    color: 'white',
  },
  scanText: {
    textAlign: 'center',
    fontSize: 20,
  },
  writeText: {
    textAlign: 'center',
    fontSize: 17,
  },
  manualText: {
    textAlign: 'center',
    fontSize: 20,
    marginBottom: 10,
  },
  typeText: {
    textAlign: 'center',
    fontSize: 17,
    color: 'grey',
  },
  copyRoot: {
    padding: 10,
    borderRadius: 8,
    flexDirection: 'row',
  },
  copyLeft: {
    flexShrink: 1,
  },
  copyRight: {
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  copyText: {
    fontSize: 17,
  },
  qrCodeContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  pressed: {
    opacity: 0.6,
  },
});

export default WalletExport;

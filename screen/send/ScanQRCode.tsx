import { RouteProp, StackActions, useIsFocused, useRoute } from '@react-navigation/native';
import * as bitcoin from 'bitcoinjs-lib';
import { sha256 } from '@noble/hashes/sha256';
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import Base43 from '../../blue_modules/base43';
import * as fs from '../../blue_modules/fs';
import { BlueURDecoder, decodeUR, extractSingleWorkload } from '../../blue_modules/ur';
import BlueText from '../../components/BlueText';
import { openPrivacyDesktopSettings } from '../../class/camera';
import Button from '../../components/Button';
import { useTheme } from '../../components/themes';
import { isCameraAuthorizationStatusGranted } from '../../helpers/scan-qr';
import loc from '../../loc';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import CameraScreen from '../../components/CameraScreen';
import SafeArea from '../../components/SafeArea';
import { SendDetailsStackParamList } from '../../navigation/SendDetailsStackParamList.ts';
import { BlueSpacing40 } from '../../components/BlueSpacing';
import { BlueLoading } from '../../components/BlueLoading.tsx';
import { hexToUint8Array, uint8ArrayToBase64, uint8ArrayToHex, uint8ArrayToString } from '../../blue_modules/uint8array-extras/index.js';

type RouteProps = RouteProp<SendDetailsStackParamList, 'ScanQRCode'>;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  openSettingsContainer: {
    justifyContent: 'center',
    alignContent: 'center',
    alignItems: 'center',
    height: '100%',
  },
  backdoorButton: {
    width: 60,
    height: 60,
    backgroundColor: 'rgba(0,0,0,0.01)',
    position: 'absolute',
    top: 60,
    left: '50%',
    transform: [{ translateX: -30 }],
  },
  backdoorInputWrapper: {
    position: 'absolute',
    left: '5%',
    top: '10%',
    width: '90%',
    height: '70%',
    backgroundColor: 'white',
  },
  progressWrapper: {
    position: 'absolute',
    alignSelf: 'center',
    alignItems: 'center',
    top: '50%',
    padding: 8,
    borderRadius: 8,
  },
  backdoorInput: {
    height: '50%',
    marginTop: 5,
    marginHorizontal: 20,
    borderWidth: 1,
    borderRadius: 4,
    textAlignVertical: 'top',
  },
});

const ScanQRCode = () => {
  const [isLoading, setIsLoading] = useState(false);
  const navigation = useExtendedNavigation();
  const route = useRoute<RouteProps>();
  const navigationState = navigation.getState();
  const previousRoute = navigationState.routes[navigationState.routes.length - 2];
  const defaultLaunchedBy = previousRoute ? previousRoute.name : undefined;

  const { launchedBy = defaultLaunchedBy, showFileImportButton, onBarScanned } = route.params || {};
  const { colors } = useTheme();
  const isFocused = useIsFocused();
  const [backdoorPressed, setBackdoorPressed] = useState(0);
  const [urTotal, setUrTotal] = useState(0);
  const [urHave, setUrHave] = useState(0);
  const [backdoorText, setBackdoorText] = useState('');
  const [backdoorVisible, setBackdoorVisible] = useState(false);
  // One capability per focused screen. Old camera callbacks and picker promises
  // retain a closed session even if this same route is focused again later.
  const session = useMemo(
    () => ({
      active: isFocused,
      completed: false,
      picking: false,
      decoder: undefined as BlueURDecoder | undefined,
      seen: new Set<string>(),
      legacyParts: {} as Record<string, string>,
      useBBQR: false,
    }),
    [isFocused],
  );
  const [cameraStatusGranted, setCameraStatusGranted] = useState<boolean | undefined>(undefined);
  const stylesHook = StyleSheet.create({
    openSettingsContainer: {
      backgroundColor: colors.brandingColor,
    },
    progressWrapper: {
      backgroundColor: colors.brandingColor,
      borderColor: colors.foregroundColor,
      borderWidth: 4,
    },
    backdoorInput: {
      borderColor: colors.formBorder,
      borderBottomColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
      color: colors.foregroundColor,
    },
  });

  useEffect(() => {
    let mounted = true;
    isCameraAuthorizationStatusGranted()
      .then(granted => {
        if (mounted) setCameraStatusGranted(granted);
      })
      .catch(() => {
        if (mounted) setCameraStatusGranted(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useLayoutEffect(() => {
    session.active = isFocused;
    session.completed = false;
    setIsLoading(false);
    setUrTotal(0);
    setUrHave(0);
    return () => {
      session.active = false;
      session.completed = true;
      session.decoder = undefined;
      session.seen.clear();
      session.legacyParts = {};
    };
  }, [isFocused, session]);

  const completeScan = (data: string) => {
    if (!session.active || session.completed) return;
    // Lock before calling user code: native events may arrive before navigation
    // finishes, and the callback itself can synchronously trigger another event.
    session.completed = true;
    session.decoder = undefined;
    session.seen.clear();
    session.legacyParts = {};
    if (onBarScanned) {
      try {
        onBarScanned(data, session.useBBQR);
      } catch {
        // The consumer may already have acted before throwing. Do not deliver
        // again or log its exception, which can contain the scanned contents.
        console.warn('Unable to handle QR scan result');
      }
      navigation.goBack();
    } else if (launchedBy) {
      navigation.dispatch(StackActions.popTo(launchedBy, { onBarScanned: data }, { merge: true }));
    }
  };

  const resetFragments = () => {
    session.decoder = undefined;
    session.seen.clear();
    session.legacyParts = {};
    session.useBBQR = false;
    setUrTotal(0);
    setUrHave(0);
  };

  const _onReadUniformResourceV2 = (part: string) => {
    if (!session.decoder) session.decoder = new BlueURDecoder();
    try {
      session.decoder.receivePart(part);
      if (session.decoder.isComplete()) {
        completeScan(session.decoder.toString());
      } else {
        setUrTotal(100);
        setUrHave(Math.floor(session.decoder.estimatedPercentComplete() * 100));
      }
    } catch {
      // Never log scanned contents or decoder exceptions containing payloads.
      resetFragments();
    }
  };

  /**
   *
   * @deprecated remove when we get rid of URv1 support
   */
  const _onReadUniformResource = (ur: string) => {
    try {
      const [index, total] = extractSingleWorkload(ur);
      session.legacyParts[index + 'of' + total] = ur;
      setUrTotal(total);
      setUrHave(Object.values(session.legacyParts).length);
      if (Object.values(session.legacyParts).length === total) {
        const payload = decodeUR(Object.values(session.legacyParts));
        // lets look inside that data
        let data: false | string = false;
        if (uint8ArrayToString(hexToUint8Array(String(payload))).startsWith('psbt')) {
          // its a psbt, and whoever requested it expects it encoded in base64
          data = uint8ArrayToBase64(hexToUint8Array(String(payload)));
        } else {
          // its something else. probably plain text is expected
          data = uint8ArrayToString(hexToUint8Array(String(payload)));
        }
        completeScan(data);
      }
    } catch {
      resetFragments();
    }
  };

  const onBarCodeRead = (ret: { data: unknown }) => {
    if (!session.active || session.completed || typeof ret.data !== 'string' || ret.data.length === 0) return;
    const h = uint8ArrayToHex(sha256(ret.data));
    if (session.seen.has(h)) {
      // this QR was already scanned by this ScanQRCode, lets prevent firing duplicate callbacks
      return;
    }
    // A long-running fountain QR must not grow the duplicate cache forever.
    if (session.seen.size >= 2048) session.seen.clear();
    session.seen.add(h);

    if (ret.data.toUpperCase().startsWith('UR:CRYPTO-ACCOUNT')) {
      return _onReadUniformResourceV2(ret.data);
    }

    if (ret.data.toUpperCase().startsWith('UR:CRYPTO-PSBT')) {
      return _onReadUniformResourceV2(ret.data);
    }

    if (ret.data.toUpperCase().startsWith('UR:CRYPTO-OUTPUT')) {
      return _onReadUniformResourceV2(ret.data);
    }

    if (ret.data.toUpperCase().startsWith('UR:CRYPTO-HDKEY')) {
      return _onReadUniformResourceV2(ret.data);
    }

    if (ret.data.toUpperCase().startsWith('UR:CRYPTO-MULTI-ACCOUNTS')) {
      return _onReadUniformResourceV2(ret.data);
    }

    if (ret.data.toUpperCase().startsWith('B$')) {
      session.useBBQR = true;
      return _onReadUniformResourceV2(ret.data);
    }

    if (ret.data.toUpperCase().startsWith('UR:BYTES')) {
      const splitted = ret.data.split('/');
      if (splitted.length === 3 && splitted[1].includes('-')) {
        return _onReadUniformResourceV2(ret.data);
      }
    }

    if (ret.data.toUpperCase().startsWith('UR')) {
      return _onReadUniformResource(ret.data);
    }

    // Electrum desktop's Base43 PSBT transport.
    let data = ret.data;
    try {
      const hex = Base43.decode(data);
      bitcoin.Psbt.fromHex(hex);
      data = uint8ArrayToBase64(hexToUint8Array(hex));
    } catch {
      // Plain invoice/address/Base64/file contents are handled by the caller.
    }
    completeScan(data);
  };

  const readPicker = async (kind: 'file' | 'image') => {
    if (!session.active || session.completed || session.picking) return;
    session.picking = true;
    setIsLoading(true);
    try {
      const data = kind === 'file' ? (await fs.showFilePickerAndReadFile())?.data : await fs.showImagePickerAndReadImage();
      if (session.active && !session.completed && data) onBarCodeRead({ data });
    } catch {
      // Canceling/denying a picker must leave the current scanner usable.
    } finally {
      session.picking = false;
      if (session.active && !session.completed) setIsLoading(false);
    }
  };

  const showFilePicker = () => readPicker('file');
  const onShowImagePickerButtonPress = () => readPicker('image');

  const dismiss = () => {
    if (!session.active || session.completed) return;
    session.active = false;
    session.completed = true;
    session.decoder = undefined;
    session.seen.clear();
    session.legacyParts = {};
    navigation.goBack();
  };

  const handleReadCode = (event: any) => {
    if (!session.picking) onBarCodeRead({ data: event?.nativeEvent?.codeStringValue });
  };

  const handleBackdoorOkPress = () => {
    setBackdoorVisible(false);
    setBackdoorText('');
    if (backdoorText) onBarCodeRead({ data: backdoorText });
  };

  // this is an invisible backdoor button on bottom left screen corner
  // tapping it 10 times fires prompt dialog asking for a string thats gona be passed to onBarCodeRead.
  // this allows to mock and test QR scanning in e2e tests
  const handleInvisibleBackdoorPress = async () => {
    setBackdoorPressed(backdoorPressed + 1);
    if (backdoorPressed < 5) return;
    setBackdoorPressed(0);
    setBackdoorVisible(true);
  };

  const render = isLoading ? (
    <BlueLoading />
  ) : (
    <View>
      {cameraStatusGranted === false ? (
        <View style={[styles.openSettingsContainer, stylesHook.openSettingsContainer]}>
          <BlueText>{loc.send.permission_camera_message}</BlueText>
          <BlueSpacing40 />
          <Button title={loc.send.open_settings} onPress={openPrivacyDesktopSettings} />
          <BlueSpacing40 />
          {showFileImportButton && <Button title={loc.wallets.import_file} onPress={showFilePicker} />}
          <BlueSpacing40 />
          <Button title={loc.wallets.list_long_choose} onPress={onShowImagePickerButtonPress} />
          <BlueSpacing40 />
          <Button title={loc._.cancel} testID="ScanQrCancelButton" onPress={dismiss} />
        </View>
      ) : isFocused && cameraStatusGranted ? (
        <CameraScreen
          onReadCode={handleReadCode}
          showFilePickerButton={showFileImportButton}
          showImagePickerButton={true}
          onFilePickerButtonPress={showFilePicker}
          onImagePickerButtonPress={onShowImagePickerButtonPress}
          onCancelButtonPress={dismiss}
        />
      ) : null}
      {urTotal > 0 && (
        <View style={[styles.progressWrapper, stylesHook.progressWrapper]} testID="UrProgressBar">
          <BlueText>{loc.wallets.please_continue_scanning}</BlueText>
          <BlueText>
            {urHave} / {urTotal}
          </BlueText>
        </View>
      )}
      {backdoorVisible && (
        <View style={styles.backdoorInputWrapper}>
          <BlueText>Provide QR code contents manually:</BlueText>
          <TextInput
            testID="scanQrBackdoorInput"
            multiline
            underlineColorAndroid="transparent"
            style={[styles.backdoorInput, stylesHook.backdoorInput]}
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            selectTextOnFocus={false}
            // UIKit disables smart quotes for email keyboards. QR contents must stay byte-for-byte intact.
            keyboardType={Platform.OS === 'android' ? 'visible-password' : 'email-address'}
            textContentType="none"
            smartInsertDelete={false}
            value={backdoorText}
            onChangeText={setBackdoorText}
          />
          <Button title="OK" testID="scanQrBackdoorOkButton" onPress={handleBackdoorOkPress} />
        </View>
      )}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={loc._.qr_custom_input_button}
        testID="ScanQrBackdoorButton"
        style={styles.backdoorButton}
        onPress={handleInvisibleBackdoorPress}
      />
    </View>
  );

  return <SafeArea style={styles.root}>{render}</SafeArea>;
};

export default ScanQRCode;

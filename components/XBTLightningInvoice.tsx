import Clipboard from '@react-native-clipboard/clipboard';
import { Buffer } from 'buffer';
import { encodeQR } from 'qr';
import React, { useRef, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import NativeShare from 'react-native-share';

import QRCode from './QRCode';
import { SettingsFootnote, SettingsListItem } from './SettingsSection';
import { useTheme } from './themes';

export type LightningReceiveInvoice = {
  invoice: string;
  sats: string;
  kind?: 'invoice' | 'offer';
};

// Tapping switches presentation; dragging remains owned by the parent scroll
// view. The selected presentation is also the outgoing share format.
export default function XBTLightningInvoice({ invoice, sats, kind = 'invoice' }: LightningReceiveInvoice) {
  const { colors } = useTheme();
  const noun = kind === 'offer' ? 'offer' : 'invoice';
  const [width, setWidth] = useState(0);
  const [showText, setShowText] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState(false);
  const sharing = useRef(false);
  const switchFormat = () => {
    setShareError(false);
    setShowText(value => !value);
  };

  const share = async () => {
    if (sharing.current) return;
    sharing.current = true;
    setShareError(false);
    try {
      if (showText) {
        await Share.share({ message: invoice });
      } else {
        // Export the request itself with a four-module quiet zone. A screen capture
        // could include wallet details or an unlaid-out view.
        const bytes = encodeQR(invoice.toUpperCase(), 'gif', {
          ecc: 'medium',
          border: 4,
          scale: 8,
        });
        const base64 = Buffer.from(bytes).toString('base64');
        if (Platform.OS === 'android') {
          // The receiving app may read the attachment after Android closes its chooser.
          const attachment = {
            type: 'image/gif',
            url: 'data:image/gif;base64,' + base64,
            useInternalStorage: true,
          };
          await NativeShare.open({ ...attachment, failOnCancel: false });
        } else {
          const { writeFileAndExport } = await import('../blue_modules/fs');
          await writeFileAndExport('xbt-lightning-' + noun + '.gif', base64, true, 'base64');
        }
      }
    } catch {
      setShareError(true);
    } finally {
      sharing.current = false;
    }
  };
  const size = Math.min(320, Math.max(0, width - 64));

  return (
    <View testID="XBTLightningReceiveInvoice" onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <Text accessibilityRole="header" style={[styles.amount, { color: colors.foregroundColor }]}>
        {kind === 'offer' && sats === '0' ? 'Receive any amount' : 'Receive ' + sats + ' sats'}
      </Text>
      <SettingsFootnote style={styles.explanation}>
        {kind === 'offer'
          ? 'Reusable BOLT12 offer. Keep RedWallet open to receive.'
          : 'Scan with an XBT Lightning wallet, or copy and share the invoice.'}
      </SettingsFootnote>
      <Pressable
        testID="XBTLightningInvoicePlate"
        accessibilityRole="button"
        accessibilityLabel={showText ? 'Show ' + noun + ' QR code' : 'Show ' + noun + ' text'}
        accessibilityHint={'Tap to switch between the QR code and ' + noun + ' text'}
        onPress={switchFormat}
        style={[styles.plate, { minHeight: size + 56 }]}
      >
        {showText ? (
          <Text
            testID="XBTLightningInvoiceText"
            selectable={false}
            numberOfLines={8}
            ellipsizeMode="middle"
            style={[styles.invoice, { color: colors.foregroundColor }]}
          >
            {invoice}
          </Text>
        ) : size > 0 ? (
          <View testID="XBTLightningInvoiceQR" pointerEvents="none" style={styles.quietZone}>
            <QRCode value={invoice.toUpperCase()} size={size} ecl="M" isLogoRendered={false} isMenuAvailable={false} />
          </View>
        ) : null}
      </Pressable>
      <SettingsFootnote style={styles.explanation}>
        {showText ? 'Share sends the full ' + noun + ' text.' : 'Share sends a scannable QR image.'}
      </SettingsFootnote>
      <SettingsListItem
        title={copied ? (kind === 'offer' ? 'Offer copied' : 'Invoice copied') : 'Copy ' + noun}
        onPress={() => {
          Clipboard.setString(invoice);
          setCopied(true);
        }}
      />
      <View style={styles.shareActions}>
        <View style={styles.shareAction}>
          <SettingsListItem title={showText ? 'Share ' + noun + ' text' : 'Share QR image'} onPress={share} />
        </View>
        <View style={styles.shareAction}>
          <SettingsListItem title={showText ? 'Switch to QR' : 'Switch to text'} onPress={switchFormat} />
        </View>
      </View>
      {shareError && (
        <SettingsFootnote style={styles.explanation}>{'Could not open sharing. Use Copy ' + noun + ' instead.'}</SettingsFootnote>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shareActions: { flexDirection: 'row', flexWrap: 'wrap' },
  shareAction: { flexGrow: 1, flexBasis: 130 },
  amount: {
    fontSize: 20,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  explanation: { paddingHorizontal: 16, paddingVertical: 12 },
  plate: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  quietZone: { padding: 16, backgroundColor: '#FFFFFF' },
  invoice: { paddingHorizontal: 16, fontSize: 12, lineHeight: 18 },
});

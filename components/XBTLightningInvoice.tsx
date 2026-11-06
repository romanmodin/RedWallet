import Clipboard from '@react-native-clipboard/clipboard';
import React, { useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import QRCode from './QRCode';
import { SettingsFootnote, SettingsListItem } from './SettingsSection';
import { useTheme } from './themes';

export type LightningReceiveInvoice = { invoice: string; sats: string };

// Tapping switches presentation; dragging remains owned by the parent scroll
// view. Copy/share always use the complete, unchanged native invoice.
export default function XBTLightningInvoice({ invoice, sats }: LightningReceiveInvoice) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [showText, setShowText] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState(false);
  const size = Math.min(320, Math.max(0, width - 64));

  return (
    <View testID="XBTLightningReceiveInvoice" onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <Text accessibilityRole="header" style={[styles.amount, { color: colors.foregroundColor }]}>
        Receive {sats} sats
      </Text>
      <SettingsFootnote style={styles.explanation}>Scan with an XBT Lightning wallet, or copy and share the invoice.</SettingsFootnote>
      <Pressable
        testID="XBTLightningInvoicePlate"
        accessibilityRole="button"
        accessibilityLabel={showText ? 'Show invoice QR code' : 'Show invoice text'}
        accessibilityHint="Tap to switch between the QR code and invoice text"
        onPress={() => setShowText(value => !value)}
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
        {showText ? 'Tap the text to show the QR code. Copy or Share includes the full invoice.' : 'Tap the QR code to show invoice text.'}
      </SettingsFootnote>
      <SettingsListItem
        title={copied ? 'Invoice copied' : 'Copy invoice'}
        onPress={() => {
          Clipboard.setString(invoice);
          setCopied(true);
        }}
      />
      <SettingsListItem
        title="Share invoice"
        onPress={async () => {
          setShareError(false);
          try {
            await Share.share({ message: invoice });
          } catch {
            setShareError(true);
          }
        }}
      />
      {shareError && <SettingsFootnote style={styles.explanation}>Could not open sharing. Use Copy invoice instead.</SettingsFootnote>}
    </View>
  );
}

const styles = StyleSheet.create({
  amount: { fontSize: 20, fontWeight: '600', paddingHorizontal: 16, paddingTop: 16 },
  explanation: { paddingHorizontal: 16, paddingVertical: 12 },
  plate: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  quietZone: { padding: 16, backgroundColor: '#FFFFFF' },
  invoice: { paddingHorizontal: 16, fontSize: 12, lineHeight: 18 },
});

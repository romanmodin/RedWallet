import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { MAX_LIGHTNING_SATS, validLightningSats } from '../blue_modules/lightning-amounts';
import { SettingsFootnote, SettingsListItem } from './SettingsSection';
import { useTheme } from './themes';

export type ChannelPaymentLimits = {
  minPartMsat?: string;
  maxPendingMsat?: string;
};
export type OpeningLimits = { minimum: string; maximum: string };

function sats(msat?: string) {
  if (!msat || !/^\d+$/.test(msat)) return 'Unavailable';
  const digits = msat.padStart(4, '0');
  const fraction = digits.slice(-3).replace(/0+$/, '');
  const whole = digits.slice(0, -3).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return whole + (fraction ? '.' + fraction : '') + ' sats';
}

type Props = {
  channel?: {
    peer: string;
    peerAlias?: string;
    sendLimits?: ChannelPaymentLimits;
    receiveLimits?: ChannelPaymentLimits;
  };
  refreshFailed: boolean;
  hidden: boolean;
  opening: OpeningLimits;
  onApply: (value: OpeningLimits) => void;
  onClose: () => void;
};

export default function XBTLightningChannelLimits({ channel, refreshFailed, hidden, opening, onApply, onClose }: Props) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState(opening);
  const valid =
    (!draft.minimum || validLightningSats(draft.minimum)) &&
    (!draft.maximum || validLightningSats(draft.maximum)) &&
    (!draft.minimum || !draft.maximum || Number(draft.minimum) <= Number(draft.maximum));
  const textColor = { color: colors.foregroundColor };
  const inputStyle = [styles.input, textColor, { borderColor: colors.hdborderColor }];
  return (
    <Modal visible presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={[styles.sheet, { backgroundColor: colors.background }]} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={[styles.title, textColor]}>
            Channel limits
          </Text>
          {refreshFailed ? (
            <SettingsFootnote>Refresh channels to see the current limits.</SettingsFootnote>
          ) : !channel ? (
            <SettingsFootnote>Select a channel to see its limits.</SettingsFootnote>
          ) : (
            <>
              <Text style={[styles.heading, textColor]}>{channel.peerAlias || channel.peer}</Text>
              {hidden ? (
                <SettingsFootnote>Reveal your balance to see this channel’s limits.</SettingsFootnote>
              ) : (
                <>
                  <Text style={[styles.heading, textColor]}>Send from this phone</Text>
                  <Text style={textColor}>Minimum per payment part: {sats(channel.sendLimits?.minPartMsat)}</Text>
                  <Text style={textColor}>Maximum in flight: {sats(channel.sendLimits?.maxPendingMsat)}</Text>
                  <Text style={[styles.heading, textColor]}>Receive on this phone</Text>
                  <Text style={textColor}>Minimum per payment part: {sats(channel.receiveLimits?.minPartMsat)}</Text>
                  <Text style={textColor}>
                    Maximum in flight:{' '}
                    {channel.receiveLimits?.maxPendingMsat === String(MAX_LIGHTNING_SATS) + '000'
                      ? 'No RedWallet cap'
                      : sats(channel.receiveLimits?.maxPendingMsat)}
                  </Text>
                </>
              )}
              <SettingsFootnote>
                Both sides agreed to these limits at opening. The peer sets your send limit. The maximum is shared by all pending payment
                parts in that direction. Available liquidity can be lower.
              </SettingsFootnote>
            </>
          )}
          <Text style={[styles.heading, textColor]}>Next channel you open</Text>
          <SettingsFootnote>
            Set the receive limits for the new channel. These settings take effect when you confirm opening it.
          </SettingsFootnote>
          <Text style={textColor}>Minimum per incoming part (sats)</Text>
          <TextInput
            accessibilityLabel="Minimum per incoming part (sats)"
            style={inputStyle}
            value={draft.minimum}
            keyboardType="number-pad"
            placeholder="Node default"
            placeholderTextColor={colors.alternativeTextColor2}
            onChangeText={minimum => setDraft(current => ({ ...current, minimum }))}
          />
          <Text style={textColor}>Maximum incoming in flight (sats)</Text>
          <TextInput
            accessibilityLabel="Maximum incoming in flight (sats)"
            style={inputStyle}
            value={draft.maximum}
            keyboardType="number-pad"
            placeholder="No RedWallet cap"
            placeholderTextColor={colors.alternativeTextColor2}
            onChangeText={maximum => setDraft(current => ({ ...current, maximum }))}
          />
          {!valid && (
            <SettingsFootnote>
              Enter positive whole sats within the XBT supply. The minimum must be at or below the maximum.
            </SettingsFootnote>
          )}
          <SettingsListItem title="Apply to next opening" disabled={!valid} onPress={() => onApply(draft)} />
          <SettingsListItem title="Cancel" onPress={onClose} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  sheet: { flex: 1 },
  content: { padding: 20, gap: 9, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  heading: { fontSize: 17, fontWeight: '600', marginTop: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    minHeight: 44,
    fontSize: 16,
  },
});

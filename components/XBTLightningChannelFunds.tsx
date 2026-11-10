import { LightningResize, resizeProgressText } from '../blue_modules/lightning-resize';
import { validLightningSats, validLightningFeeRate } from '../blue_modules/lightning-amounts';
import React, { useEffect, useRef, useState } from 'react';
import { NativeModules, StyleSheet, Text, TextInput, View } from 'react-native';
import SettingsExplanation from './SettingsExplanation';
import { SettingsFootnote, SettingsListItem } from './SettingsSection';
import { useTheme } from './themes';

type Review = {
  token: string;
  point: string;
  direction: string;
  address: string;
  sats: string;
  fee: string;
  feeRate: string;
  capacity: string;
  local: string;
  lockDepth: string;
};
type Props = {
  point: string;
  active: boolean;
  hideBalances?: boolean;
  splice?: LightningResize;
  busy: boolean;
  run: (title: string, action: () => Promise<void>) => Promise<void>;
  runAuthorized: (title: string, action: () => Promise<void>) => Promise<void>;
  report: (message: string) => void;
  onUpdated: () => void;
};
const reasons: Record<string, string> = {
  disabled: 'Splicing is disabled on this node.',
  peer_offline: 'The peer must be online.',
  peer_unsupported: 'This peer does not support splicing.',
  no_unified_sigs: 'This channel cannot be spliced.',
  taproot: 'This channel type cannot be spliced.',
  zero_conf: 'Wait for channel confirmation.',
  pending: 'A resize is already in progress.',
  closing: 'This channel is closing.',
  peer_not_locked: 'Waiting for the peer to lock the previous resize.',
};

export default function XBTLightningChannelFunds({
  point,
  active,
  hideBalances = false,
  splice,
  busy,
  run,
  runAuthorized,
  report,
  onUpdated,
}: Props) {
  const { colors, dark } = useTheme();
  const informationColor = colors.settingsTextColor ?? colors.alternativeTextColor;
  const addColor = dark ? '#73DFA6' : '#147648';
  const removeColor = dark ? '#FF8D96' : '#B42318';
  const [direction, setDirection] = useState<'in' | 'out'>();
  const [sats, setSats] = useState('');
  const [feeRate, setFeeRate] = useState('1');
  const [review, setReview] = useState<{ item: Review; key: string }>();
  const submitted = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = useRef('');
  current.current = JSON.stringify([point, direction, sats, feeRate]);
  const available = active && !!splice && ['ok', 'peer_not_announcing'].includes(splice.status);
  const valid = validLightningSats(sats) && validLightningFeeRate(feeRate);
  const select = (value: 'in' | 'out') => {
    setDirection(value);
    setReview(undefined);
  };
  const confirm = () => {
    if (!review || review.key !== current.current || !available || busy || submitted.current.has(review.item.token)) return;
    const item = review.item;
    runAuthorized(item.direction === 'in' ? 'Add channel funds' : 'Remove channel funds', async () => {
      if (!mounted.current || review.key !== current.current || submitted.current.has(item.token)) return;
      submitted.current.add(item.token);
      setReview(undefined);
      try {
        const result = await NativeModules.XBTLightningBridge.splice('confirm', item.token);
        report(result);
      } catch (error) {
        const failure = error as { code?: string; message?: string };
        report(
          failure.code === 'splice_failed' && failure.message
            ? failure.message
            : 'Resize outcome unknown or not completed. Refresh channels and check the node before creating another resize.',
        );
      } finally {
        onUpdated();
      }
    });
  };
  const inputStyle = [styles.input, { color: busy ? informationColor : colors.foregroundColor, borderColor: colors.hdborderColor }];
  return (
    <View testID={'ChannelFunds-' + point}>
      {!!splice?.progress && <SettingsFootnote>{resizeProgressText(splice)}</SettingsFootnote>}
      {!available && (
        <SettingsFootnote>{reasons[splice?.status ?? ''] || 'Resizing is unavailable for this channel right now.'}</SettingsFootnote>
      )}
      <SettingsListItem title="Add funds" titleStyle={{ color: addColor }} disabled={busy || !available} onPress={() => select('in')} />
      <SettingsListItem
        title="Remove funds"
        titleStyle={{ color: removeColor }}
        disabled={busy || !available}
        onPress={() => select('out')}
      />
      {direction && (
        <View>
          <SettingsExplanation
            id={'lightning.resize-' + direction}
            title={direction === 'in' ? 'About adding channel funds' : 'About removing channel funds'}
          >
            {direction === 'in'
              ? 'Add funds from the Lightning node’s on-chain balance.'
              : 'Return funds to the Lightning node’s on-chain wallet. The peer’s funds remain theirs.'}
          </SettingsExplanation>
          <TextInput
            accessibilityLabel="Channel resize sats"
            placeholder="Amount in sats"
            keyboardType="number-pad"
            placeholderTextColor={colors.alternativeTextColor2}
            style={inputStyle}
            value={sats}
            editable={!busy}
            onChangeText={value => {
              setSats(value);
              setReview(undefined);
            }}
          />
          <TextInput
            accessibilityLabel="Channel resize fee rate"
            placeholder="Fee rate (sat/vB)"
            keyboardType="number-pad"
            placeholderTextColor={colors.alternativeTextColor2}
            style={inputStyle}
            value={feeRate}
            editable={!busy}
            onChangeText={value => {
              setFeeRate(value);
              setReview(undefined);
            }}
          />
          <SettingsListItem
            title="Review channel resize"
            disabled={busy || !available || !valid}
            onPress={() => {
              const key = current.current;
              setReview(undefined);
              run('Review channel resize', async () => {
                const item: Review = await NativeModules.XBTLightningBridge.splice(
                  'review',
                  JSON.stringify({ point, direction, sats, feeRate }),
                );
                if (current.current !== key) return;
                if (item.point !== point || item.direction !== direction || item.sats !== sats || item.feeRate !== feeRate || !item.token) {
                  throw new Error('Channel resize review did not match the request.');
                }
                setReview({ item, key });
                report('Review ready. No funds have moved.');
              });
            }}
          />
          {review && review.key === current.current && available && (
            <View>
              <Text selectable style={[styles.review, { color: informationColor }]}>
                {(direction === 'in' ? 'Add ' : 'Remove ') +
                  review.item.sats +
                  ' sats\nChannel: ' +
                  review.item.point +
                  '\nEstimated network fee: ' +
                  review.item.fee +
                  ' sats at ' +
                  review.item.feeRate +
                  ' sat/vB' +
                  '\nNew capacity: ' +
                  (hideBalances ? '••••' : review.item.capacity + ' sats') +
                  '\nYour resulting balance: ' +
                  (hideBalances ? '••••' : review.item.local + ' sats') +
                  (direction === 'out' ? '\nReturn address: ' + review.item.address : '') +
                  '\nLocal required confirmations: ' +
                  review.item.lockDepth +
                  '\nThe peer may require more confirmations. The final fee may vary with transaction size. Wait for both peers to lock the resize.'}
              </Text>
              <SettingsListItem
                title={direction === 'in' ? 'Confirm add funds' : 'Confirm remove funds'}
                titleStyle={{ color: direction === 'in' ? addColor : removeColor }}
                disabled={busy}
                onPress={confirm}
              />
            </View>
          )}
          <SettingsListItem
            title="Cancel resize review"
            disabled={busy}
            onPress={() => {
              setDirection(undefined);
              setReview(undefined);
            }}
          />
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  input: {
    margin: 12,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    fontSize: 16,
  },
  review: { padding: 16, fontSize: 15 },
});

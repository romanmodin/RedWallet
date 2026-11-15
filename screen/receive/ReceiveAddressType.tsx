import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { XbtAccount, XbtAddressType, xbtAddressType } from '../../blue_modules/xbt-account-groups';
import { useTheme } from '../../components/themes';
import loc from '../../loc';

type Props = {
  selected: XbtAddressType;
  accounts: XbtAccount[];
  disabled: boolean;
  canAddType: boolean;
  onSelect: (type: XbtAddressType) => void;
};

export default function ReceiveAddressType({ selected, accounts, disabled, canAddType, onSelect }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.container}>
      <Text style={[styles.heading, { color: colors.alternativeTextColor }]}>{loc.xbt_accounts.receive_type}</Text>
      <View style={styles.options} accessibilityRole="radiogroup">
        {(['segwit', 'taproot'] as const).map(type => {
          const account = accounts.find(candidate => xbtAddressType(candidate) === type);
          const checked = selected === type;
          const unavailable = disabled || (!account && !canAddType);
          const color = unavailable ? colors.alternativeTextColor : checked ? colors.primary : colors.foregroundColor;
          return (
            <Pressable
              key={type}
              accessibilityRole="radio"
              accessibilityLabel={type === 'taproot' ? 'Taproot' : 'Native SegWit'}
              accessibilityState={{ checked, disabled: unavailable }}
              testID={'ReceiveAddressType-' + type}
              disabled={unavailable}
              onPress={() => {
                if (!checked) onSelect(type);
              }}
              style={[
                styles.option,
                {
                  borderColor: checked ? colors.primary : colors.alternativeTextColor,
                },
              ]}
            >
              <View style={[styles.radio, { borderColor: color }]}>
                {checked && <View style={[styles.dot, { backgroundColor: color }]} />}
              </View>
              <Text style={{ color }}>{type === 'taproot' ? 'Taproot' : 'Native SegWit'}</Text>
            </Pressable>
          );
        })}
      </View>
      {accounts.length < 2 && !canAddType && (
        <Text style={[styles.help, { color: colors.alternativeTextColor }]}>{loc.xbt_accounts.receive_type_unavailable}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginHorizontal: 24, marginTop: 20 },
  heading: { fontSize: 13, fontWeight: '600', marginBottom: 10 },
  options: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  option: {
    minHeight: 48,
    flex: 1,
    minWidth: 120,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  radio: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  help: { fontSize: 13, marginTop: 10 },
});

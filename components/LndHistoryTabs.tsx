import React from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useTheme } from './themes';

const tabs = [
  {
    id: 'transactions',
    label: 'Transactions',
    icon: 'list-outline',
    light: '#FFFAF7',
    dark: '#332C2E',
  },
  {
    id: 'crossChain',
    label: 'Cross-chain payments',
    icon: 'swap-horizontal-outline',
    light: '#F5E6E9',
    dark: '#46313A',
  },
  {
    id: 'funding',
    label: 'Funding',
    icon: 'wallet-outline',
    light: '#E7DADF',
    dark: '#4E4049',
  },
] as const;

export type LndHistoryTab = (typeof tabs)[number]['id'];

export default function LndHistoryTabs({ selected, onSelect }: { selected: LndHistoryTab; onSelect: (tab: LndHistoryTab) => void }) {
  const { colors, dark } = useTheme();
  const { fontScale } = useWindowDimensions();
  const underlineColor = dark ? '#F3A9B6' : '#A81F35';
  const fill = dark ? 'dark' : 'light';
  const leftBacking = selected === 'crossChain' ? tabs[0] : tabs[1];
  const rightBacking = selected === 'crossChain' ? tabs[2] : tabs[1];
  return (
    <View testID="LndHistoryTabs" accessibilityRole="tablist" style={[styles.strip, { height: Math.ceil(52 * Math.max(1, fontScale)) }]}>
      {/* The rear colors run straight under the rounded face, including both upper corners. */}
      <View pointerEvents="none" accessible={false} style={styles.backing}>
        <View style={[styles.half, { backgroundColor: leftBacking[fill] }]} />
        <View style={[styles.half, { backgroundColor: rightBacking[fill] }]} />
      </View>
      {tabs.map(tab => {
        const active = tab.id === selected;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(tab.id)}
            style={[styles.tab, active && styles.active, { backgroundColor: tab[fill] }]}
          >
            {active ? (
              <>
                <Text style={[styles.label, { color: colors.foregroundColor }]}>{tab.label}</Text>
                <View pointerEvents="none" style={[styles.underline, { backgroundColor: underlineColor }]} />
              </>
            ) : (
              <Ionicons name={tab.icon} size={22} color={colors.foregroundColor} importantForAccessibility="no" />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row' },
  tab: {
    flexBasis: '18%',
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  backing: { ...StyleSheet.absoluteFill, flexDirection: 'row' },
  half: { flex: 1 },
  active: {
    flexBasis: '64%',
    flexShrink: 1,
    borderTopLeftRadius: 13.25,
    borderTopRightRadius: 13.25,
  },
  underline: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2 },
  label: { fontSize: 21, fontWeight: '700', textAlign: 'center' },
});

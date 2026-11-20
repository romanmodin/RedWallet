import React from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import WalletGradient from '../class/wallet-gradient';

const tabs = [
  { id: 'transactions', label: 'Transactions', icon: 'list-outline' },
  { id: 'crossChain', label: 'Cross-chain payments', icon: 'swap-horizontal-outline' },
  { id: 'funding', label: 'Funding', icon: 'wallet-outline' },
] as const;

const tabInk = '#351D25';
const cornerRadius = 13.25;

export type LndHistoryTab = (typeof tabs)[number]['id'];

export default function LndHistoryTabs({ selected, onSelect }: { selected: LndHistoryTab; onSelect: (tab: LndHistoryTab) => void }) {
  const { fontScale } = useWindowDimensions();
  const selectedIndex = tabs.findIndex(tab => tab.id === selected);
  const mintIndex = selectedIndex === 0 ? 1 : 0;
  return (
    <View testID="LndHistoryTabs" accessibilityRole="tablist" style={[styles.strip, { height: Math.ceil(52 * Math.max(1, fontScale)) }]}>
      {tabs.map((tab, index) => {
        const active = index === selectedIndex;
        const face = active ? styles.selectedFace : index < selectedIndex ? styles.beforeSelected : styles.afterSelected;
        const color = active ? styles.white : index === mintIndex ? styles.mint : styles.sky;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(tab.id)}
            style={[styles.tab, active && styles.active, { zIndex: tabs.length - Math.abs(index - selectedIndex) }]}
          >
            <View testID="LndHistoryTabFace" pointerEvents="none" accessible={false} style={[StyleSheet.absoluteFill, face, color]} />
            {active ? (
              <Text style={styles.label}>{tab.label}</Text>
            ) : (
              <Ionicons name={tab.icon} size={22} color={tabInk} importantForAccessibility="no" />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', backgroundColor: WalletGradient.xbtWallet[WalletGradient.xbtWallet.length - 1] },
  tab: {
    flexBasis: '18%',
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  active: { flexBasis: '64%', flexShrink: 1 },
  // Only the painted face extends under its neighbor. The pressable keeps its own bounds.
  beforeSelected: { right: -cornerRadius, borderTopLeftRadius: cornerRadius },
  afterSelected: { left: -cornerRadius, borderTopRightRadius: cornerRadius },
  selectedFace: { borderTopLeftRadius: cornerRadius, borderTopRightRadius: cornerRadius },
  white: { backgroundColor: '#FFFFFF' },
  mint: { backgroundColor: '#D7EFE2' },
  sky: { backgroundColor: '#DBEDFC' },
  label: { color: tabInk, fontSize: 21, fontWeight: '700', textAlign: 'center' },
});

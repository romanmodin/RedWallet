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

type LndHistoryTabsProps = {
  selected: LndHistoryTab;
  onSelect: (tab: LndHistoryTab) => void;
  receiveColor: string;
};

export default function LndHistoryTabs({ selected, onSelect, receiveColor }: LndHistoryTabsProps) {
  const { fontScale } = useWindowDimensions();
  const selectedIndex = tabs.findIndex(tab => tab.id === selected);
  const greenIndex = selectedIndex === 0 ? 1 : 0;
  return (
    <View testID="LndHistoryTabs" accessibilityRole="tablist" style={[styles.strip, { height: Math.ceil(52 * Math.max(1, fontScale)) }]}>
      {tabs.map((tab, index) => {
        const active = index === selectedIndex;
        const face = active ? styles.selectedFace : index < selectedIndex ? styles.beforeSelected : styles.afterSelected;
        const backgroundColor = active ? '#FFFFFF' : index === greenIndex ? receiveColor : '#2166A5';
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(tab.id)}
            style={[styles.tab, active ? styles.expanded : styles.compact, { zIndex: tabs.length - Math.abs(index - selectedIndex) }]}
          >
            <View
              testID="LndHistoryTabFace"
              pointerEvents="none"
              accessible={false}
              style={[StyleSheet.absoluteFill, face, { backgroundColor }]}
            />
            {active ? (
              <Text style={styles.label} numberOfLines={fontScale > 1.3 ? 2 : 1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {tab.label}
              </Text>
            ) : (
              <Ionicons name={tab.icon} size={22} color="#FFFFFF" importantForAccessibility="no" />
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
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  compact: { width: '18%' },
  expanded: { width: '64%', flexShrink: 1 },
  // Only the painted face extends under its neighbor. The pressable keeps its own bounds.
  beforeSelected: { right: -cornerRadius, borderTopLeftRadius: cornerRadius },
  afterSelected: { left: -cornerRadius, borderTopRightRadius: cornerRadius },
  selectedFace: { borderTopLeftRadius: cornerRadius, borderTopRightRadius: cornerRadius },
  label: { color: tabInk, fontSize: 21, fontWeight: '400', textAlign: 'center' },
});

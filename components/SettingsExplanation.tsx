import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@react-native-vector-icons/ionicons';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SettingsFootnote } from './SettingsSection';
import { useTheme } from './themes';

/** Only reusable help belongs here. Live status, warnings and spend details stay visible. */
export default function SettingsExplanation({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(true);
  const touched = useRef(false);
  const storageKey = 'settings-explanation.v1.' + id;
  useEffect(() => {
    let mounted = true;
    touched.current = false;
    setExpanded(true);
    AsyncStorage.getItem(storageKey)
      .then(value => {
        if (mounted && !touched.current) setExpanded(value !== 'collapsed');
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [storageKey]);
  const toggle = () => {
    touched.current = true;
    const next = !expanded;
    setExpanded(next);
    AsyncStorage.setItem(storageKey, next ? 'expanded' : 'collapsed').catch(() => {});
  };
  return (
    <Pressable
      testID={'SettingsExplanation-' + id}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityHint={expanded ? 'Tap to collapse this explanation.' : 'Tap to expand this explanation.'}
      onPress={toggle}
      style={styles.container}
    >
      <View style={styles.heading}>
        <Text style={[styles.title, { color: colors.foregroundColor }]}>{title}</Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.settingsTextColor ?? colors.alternativeTextColor}
          importantForAccessibility="no"
        />
      </View>
      {expanded && <SettingsFootnote style={styles.body}>{children}</SettingsFootnote>}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 13, fontWeight: '500', textTransform: 'uppercase', flexShrink: 1 },
  body: { paddingTop: 8 },
});

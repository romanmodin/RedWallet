import React, { useRef } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { isArtworkDoubleTap, toggleArtworkSkin, useArtworkSkin } from '../blue_modules/artwork-skin';
import { useTheme } from './themes';

export default function ArtworkSkinToggle() {
  const active = useArtworkSkin();
  const lastTap = useRef<number | undefined>(undefined);
  const { colors } = useTheme();
  const toggle = () => {
    toggleArtworkSkin().catch(() => Alert.alert('Skin unchanged', 'Unable to save the appearance setting. Please try again.'));
  };
  const onPress = () => {
    const now = Date.now();
    if (isArtworkDoubleTap(lastTap.current, now)) {
      lastTap.current = undefined;
      toggle();
    } else lastTap.current = now;
  };
  return (
    <View style={styles.container}>
      <Pressable
        testID="ArtworkSkinLogo"
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={active ? 'Artwork skin enabled' : 'Artwork skin disabled'}
        accessibilityHint="Double-tap the logo to toggle the optional wallet background"
        accessibilityActions={[{ name: 'activate', label: 'Toggle artwork skin' }]}
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'activate') toggle();
        }}
      >
        <Image source={require('../img/optional-skin/logo.png')} style={styles.logo} resizeMode="contain" />
      </Pressable>
      <Text style={[styles.caption, { color: colors.alternativeTextColor }]}>
        {active ? 'Double-tap logo to restore the normal appearance' : 'Double-tap logo for the optional artwork skin'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 20 },
  logo: { width: 92, height: 92, borderRadius: 12 },
  caption: { fontSize: 12, textAlign: 'center', marginTop: 10 },
});

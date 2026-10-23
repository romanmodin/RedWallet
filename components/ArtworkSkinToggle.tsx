import React from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { toggleArtworkSkin, useArtworkSkinSelection } from '../blue_modules/artwork-skin';
import { useTheme } from './themes';

export default function ArtworkSkinToggle() {
  const skin = useArtworkSkinSelection();
  const label = { off: 'Off', helmet: 'Helmet', armour: 'Armour' }[skin];
  const { colors } = useTheme();
  const toggle = () => {
    toggleArtworkSkin().catch(() => Alert.alert('Skin unchanged', 'Unable to save the appearance setting. Please try again.'));
  };
  return (
    <View style={styles.container}>
      <Pressable
        testID="ArtworkSkinLogo"
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={`Artwork skin: ${label}`}
        accessibilityHint="Activate to cycle Off, Helmet, Armour, then Off"
        accessibilityActions={[{ name: 'activate', label: 'Next artwork skin' }]}
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'activate') toggle();
        }}
      >
        <Image source={require('../img/optional-skin/logo.png')} style={styles.logo} resizeMode="contain" />
      </Pressable>
      <Text style={[styles.caption, { color: colors.alternativeTextColor }]}>{`Skin: ${label} · Tap logo for next skin`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 20 },
  logo: { width: 92, height: 92, borderRadius: 12 },
  caption: { fontSize: 12, textAlign: 'center', marginTop: 10 },
});

import React, { createContext } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useTheme } from './themes';

/** Only rows on the artwork-backed wallet dashboard become translucent. */
export const ArtworkSurfaceContext = createContext(false);

export default function ArtworkSkinSurface({ active, children }: { active: boolean; children: React.ReactNode }) {
  const { dark } = useTheme();
  return (
    <ArtworkSurfaceContext.Provider value={active}>
      <View style={styles.container}>
        {active && (
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={StyleSheet.absoluteFill}
          >
            <Image
              testID="ArtworkSkinBackground"
              source={require('../img/optional-skin/background.jpeg')}
              resizeMode="cover"
              style={StyleSheet.absoluteFill}
            />
            <View style={[StyleSheet.absoluteFill, dark ? styles.darkReadability : styles.lightReadability]} />
          </View>
        )}
        {children}
      </View>
    </ArtworkSurfaceContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  darkReadability: { backgroundColor: 'rgba(0,0,0,0.26)' },
  lightReadability: { backgroundColor: 'rgba(255,255,255,0.72)' },
});

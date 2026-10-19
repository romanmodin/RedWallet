import React, { createContext, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useTheme } from './themes';

/** Only rows on the artwork-backed wallet dashboard become translucent. */
export const ArtworkSurfaceContext = createContext(false);

export default function ArtworkSkinSurface({ active, children }: { active: boolean; children: React.ReactNode }) {
  const { dark } = useTheme();
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const backdrop = dark ? '#080605' : '#FFFFFF';
  // Fit the landscape artwork into a portrait hero, not the entire scrolling
  // screen. Measure this surface so split-view and rotation stay centered.
  const artworkHeight = Math.min(bounds.height, bounds.width * 1.15);
  return (
    <ArtworkSurfaceContext.Provider value={active}>
      <View
        testID="ArtworkSkinSurface"
        style={[styles.container, active && { backgroundColor: backdrop }]}
        onLayout={({ nativeEvent: { layout } }) => setBounds({ width: layout.width, height: layout.height })}
      >
        {active && (
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={StyleSheet.absoluteFill}
          >
            <View style={{ width: bounds.width, height: artworkHeight }}>
              <Image
                testID="ArtworkSkinBackground"
                source={require('../img/optional-skin/background.jpeg')}
                resizeMode="cover"
                style={[StyleSheet.absoluteFill, { width: bounds.width, height: artworkHeight }]}
              />
              <LinearGradient
                colors={[dark ? 'rgba(8,6,5,0)' : 'rgba(255,255,255,0)', backdrop]}
                locations={[0.55, 1]}
                style={StyleSheet.absoluteFill}
              />
            </View>
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

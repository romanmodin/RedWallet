import React, { createContext, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useTheme } from './themes';
import { ArtworkSkin } from '../blue_modules/artwork-skin';

/** Only rows on the artwork-backed wallet dashboard become translucent. */
export const ArtworkSurfaceContext = createContext(false);

export default function ArtworkSkinSurface({
  active,
  skin = 'helmet',
  children,
}: {
  active: boolean;
  skin?: ArtworkSkin;
  children: React.ReactNode;
}) {
  const { dark } = useTheme();
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const backdrop = dark ? '#080605' : '#FFFFFF';
  // Keep the original landscape crop bounded; fit the new portrait image whole.
  // Measure this surface so split-view and rotation stay centered.
  const artworkHeight = Math.min(bounds.height, bounds.width * (skin === 'armour' ? 739 / 415 : 1.15));
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
                source={skin === 'armour' ? require('../img/optional-skin/armour.jpeg') : require('../img/optional-skin/background.jpeg')}
                resizeMode={skin === 'armour' ? 'contain' : 'cover'}
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

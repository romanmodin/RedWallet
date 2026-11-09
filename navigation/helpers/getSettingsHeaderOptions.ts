import { Platform, PlatformColor } from 'react-native';
import type { Theme } from '../../components/themes';

// Shared compact, centered appearance for Settings and its submenus.
export const getSettingsHeaderOptions = (title: string, theme: Theme) => {
  // Native headers accept dynamic iOS colors; keep their opaque value intact.
  const titleColor = (Platform.OS === 'ios' ? PlatformColor('label') : theme.colors.foregroundColor) as string;
  return {
    title: title.toUpperCase(),
    headerLargeTitle: false,
    headerLargeTitleShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal' as const,
    headerTitleAlign: 'center' as const,
    headerTitleStyle: {
      color: titleColor,
      fontSize: 22,
      fontWeight: '400' as const,
    },
    headerShadowVisible: false,
    headerTransparent: false,
    headerBlurEffect: undefined,
    headerStyle: {
      backgroundColor: theme.colors.background,
    },
  };
};

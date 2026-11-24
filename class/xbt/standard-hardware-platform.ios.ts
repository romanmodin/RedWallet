import { NativeModules, Platform } from 'react-native';

export const STANDARD_HARDWARE_RELEASE_ENABLED =
  Platform.OS === 'ios' && Platform.constants.interfaceIdiom === 'phone' && NativeModules.RedWalletSeparationHTTP?.internalKeystone === true;

import { Alert } from 'react-native';
import loc from '../loc';

export default function confirmCoinPrivacy(): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(
      loc.cc.privacy_warning_title,
      loc.cc.privacy_warning,
      [
        { text: loc.cc.privacy_choose_again, style: 'cancel', onPress: () => resolve(false) },
        { text: loc.cc.privacy_continue, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

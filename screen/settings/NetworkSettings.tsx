import React from 'react';
import { isNotificationsCapable } from '../../blue_modules/notifications';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import { SettingsSection, SettingsListItem, SettingsScrollView } from '../../components/SettingsSection';

const NetworkSettings: React.FC = () => {
  const navigation = useExtendedNavigation();
  const navigateToElectrumSettings = () => {
    navigation.navigate('ElectrumSettings');
  };

  const navigateToNotificationSettings = () => {
    navigation.navigate('NotificationSettings');
  };

  return (
    <SettingsScrollView>
      <SettingsSection>
        <SettingsListItem
          title={loc.settings.network_electrum}
          iconName="electrum"
          onPress={navigateToElectrumSettings}
          testID="ElectrumSettings"
          chevron
          bottomDivider={isNotificationsCapable}
        />

        {isNotificationsCapable && (
          <SettingsListItem
            title={loc.settings.notifications}
            iconName="notifications"
            onPress={navigateToNotificationSettings}
            testID="NotificationSettings"
            chevron
            bottomDivider={false}
          />
        )}
      </SettingsSection>
    </SettingsScrollView>
  );
};

export default NetworkSettings;

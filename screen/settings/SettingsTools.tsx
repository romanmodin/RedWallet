import React from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from '../../components/themes';

import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import { SettingsSection, SettingsListItem, SettingsScrollView } from '../../components/SettingsSection';

const SettingsTools: React.FC = () => {
  const navigation = useExtendedNavigation();
  const { dark } = useTheme();
  const navigateToIsItMyAddress = () => {
    navigation.navigate('IsItMyAddress');
  };

  const navigateToBroadcast = () => {
    navigation.navigate('Broadcast');
  };

  const navigateToGenerateWord = () => {
    navigation.navigate('GenerateWord');
  };

  return (
    <SettingsScrollView>
      <SettingsSection>
        <SettingsListItem
          title="CoinJoin — Experimental"
          subtitle="Opt-in mixing · Still in testing"
          titleStyle={dark ? styles.experimentalDark : styles.experimentalLight}
          containerStyle={styles.experimentalRow}
          iconName="tools"
          onPress={() => navigation.navigate('CoinjoinExperimental')}
          testID="CoinjoinExperimental"
          chevron
        />
        <SettingsListItem
          title={loc.is_it_my_address.title}
          iconName="search"
          onPress={navigateToIsItMyAddress}
          testID="IsItMyAddress"
          chevron
        />
        <SettingsListItem
          title={loc.settings.network_broadcast}
          iconName="paperPlane"
          onPress={navigateToBroadcast}
          testID="Broadcast"
          chevron
        />
        <SettingsListItem
          title={loc.autofill_word.title}
          iconName="key"
          onPress={navigateToGenerateWord}
          testID="GenerateWord"
          chevron
          bottomDivider={false}
        />
      </SettingsSection>
    </SettingsScrollView>
  );
};

const styles = StyleSheet.create({
  experimentalDark: { color: '#D9A53A' },
  experimentalLight: { color: '#805500' },
  experimentalRow: { borderLeftWidth: 3, borderLeftColor: '#D9A53A' },
});
export default SettingsTools;

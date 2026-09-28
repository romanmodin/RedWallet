import React from 'react';
import { SettingsSection, SettingsListItem, SettingsScrollView } from '../../components/SettingsSection';

const SettingsBlockExplorer: React.FC = () => (
  <SettingsScrollView>
    <SettingsSection>
      <SettingsListItem
        title="Explorer unavailable"
        subtitle="An XBT explorer is not available in this release. You can copy transaction IDs from transaction details."
        subtitleNumberOfLines={0}
        disabled
        bottomDivider={false}
      />
    </SettingsSection>
  </SettingsScrollView>
);

export default SettingsBlockExplorer;

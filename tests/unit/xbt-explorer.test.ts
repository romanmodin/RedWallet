import DefaultPreference from 'react-native-default-preference';
import { getBlockExplorerUrl, getBlockExplorersList, getTransactionExplorerUrl, saveBlockExplorer } from '../../models/blockExplorer';

const txid = '01'.repeat(32);

describe('XBT explorer availability', () => {
  beforeEach(async () => {
    await DefaultPreference.setName('xbt-explorer-test');
    await DefaultPreference.clear('blockExplorer');
  });

  it.each(['https://mempool.space', 'https://blockstream.info', 'https://unverified.example'])(
    'does not restore or use a saved unverified explorer: %s',
    async url => {
      await DefaultPreference.set('blockExplorer', url);
      expect(await getBlockExplorerUrl()).toBe('');
      expect(getBlockExplorersList()).toEqual([]);
      expect(getTransactionExplorerUrl(txid)).toBeUndefined();
    },
  );

  it('rejects custom explorer activation until XBT support has been verified', async () => {
    expect(await saveBlockExplorer('https://unverified.example')).toBe(false);
    expect(await DefaultPreference.get('blockExplorer')).toBeNull();
    expect(await saveBlockExplorer('')).toBe(true);
    expect(getTransactionExplorerUrl()).toBeUndefined();
  });
});

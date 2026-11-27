import '../../shim';
import { AppRegistry } from 'react-native';
import FS from 'react-native-fs';
import { fixture, reward } from '../helpers/mined-ancestry-fixture';
import { verifyMinedAncestry } from '../../class/xbt/separation-proof';

function checkAncestry() {
  const f = fixture();
  const verify = path => verifyMinedAncestry(f.selected, path, f.proof, f.anchor);
  const linked = verify(f.path).getId() === f.mined.getId();
  let unrelatedRejected = false;
  try {
    verify([f.path[0], reward(3).toHex()]);
  } catch (error) {
    unrelatedRejected = error.message.includes('separation');
  }
  return { hermes: !!global.HermesInternal, linked, unrelatedRejected };
}

AppRegistry.registerComponent('BlueWallet', () => () => null);
Promise.resolve().then(checkAncestry).catch(error => ({ error: String(error) })).then(result =>
  FS.writeFile(FS.DocumentDirectoryPath + '/ancestry-result.json', JSON.stringify(result)),
);

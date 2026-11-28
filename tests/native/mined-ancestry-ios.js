import '../../shim';
import { AppRegistry } from 'react-native';
import FS from 'react-native-fs';
import { discoverMinedAncestry } from '../../class/xbt/mined-ancestry-discovery';
import { verifyMinedRequestFunding } from '../../class/xbt/mined-request-funding';
import { syntheticMinedRequest, verifySyntheticOneXbtRequest } from './mined-ancestry-protected-case';
import { fixture, reward } from '../helpers/mined-ancestry-fixture';
import { verifyMinedAncestry } from '../../class/xbt/separation-proof';

async function checkAncestry() {
  const f = fixture(975000, true);
  const verify = path => verifyMinedAncestry(f.selected, path, f.proof, f.anchor);
  const linked = verify(f.path).getId() === f.mined.getId();
  let unrelatedRejected = false;
  try {
    verify([f.path[0], reward(3).toHex()]);
  } catch (error) {
    unrelatedRejected = error.message.includes('separation');
  }
  const raws = Object.fromEntries([f.spend, f.mined, f.sharedReward].map(tx => [tx.getId(), tx.toHex()]));
  const readRaw = async ids => Object.fromEntries(ids.map(id => [id, raws[id]]));
  const found = [];
  for await (const candidate of discoverMinedAncestry(f.selected, readRaw, () => {})) {
    found.push(verify(candidate.path).getId());
  }
  const secondParentDiscovered = found.length === 1 && found[0] === f.mined.getId();
  const protectedCase = await verifySyntheticOneXbtRequest({ omitSharedParent: true });
  const pair = syntheticMinedRequest({ twoInputs: true, omitSharedParent: true });
  await verifyMinedRequestFunding(pair.request, pair.collect, pair.readTip, () => {});
  return { ...protectedCase, twoInputsVerified: pair.request.inputCount === 2, partialHistoryVerified: protectedCase.unsignedOneXbtVerified, secondParentDiscovered, hermes: !!global.HermesInternal, linked, unrelatedRejected };
}

AppRegistry.registerComponent('BlueWallet', () => () => null);
Promise.resolve().then(checkAncestry).catch(error => ({ error: String(error) })).then(result =>
  FS.writeFile(FS.DocumentDirectoryPath + '/ancestry-result.json', JSON.stringify(result)),
);

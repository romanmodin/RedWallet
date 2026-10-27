/** Offline native qualification: public RFC9474 vector and a disposable encrypted test record only. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Keychain from 'react-native-keychain';
import { blind, finalize, prepare, publicKey } from './blind-rsa';
import { nativeEntropy } from './wallet-adapter';
import { SessionVault } from './vault';
import { SessionState } from './session';
import { utf8Hash } from './crypto';
import { runKilojoinV5SelfTest } from './v5-self-test';
import { runKilojoinStartupSelfTest } from './startup-self-test';
const vector = {
  N: 'aec4d69addc70b990ea66a5e70603b6fee27aafebd08f2d94cbe1250c556e047a928d635c3f45ee9b66d1bc628a03bac9b7c3f416fe20dabea8f3d7b4bbf7f963be335d2328d67e6c13ee4a8f955e05a3283720d3e1f139c38e43e0338ad058a9495c53377fc35be64d208f89b4aa721bf7f7d3fef837be2a80e0f8adf0bcd1eec5bb040443a2b2792fdca522a7472aed74f31a1ebe1eebc1f408660a0543dfe2a850f106a617ec6685573702eaaa21a5640a5dcaf9b74e397fa3af18a2f1b7c03ba91a6336158de420d63188ee143866ee415735d155b7c2d854d795b7bc236cffd71542df34234221a0413e142d8c61355cc44d45bda94204974557ac2704cd8b593f035a5724b1adf442e78c542cd4414fce6f1298182fb6d8e53cef1adfd2e90e1e4deec52999bdc6c29144e8d52a125232c8c6d75c706ea3cc06841c7bda33568c63a6c03817f722b50fcf898237d788a4400869e44d90a3020923dc646388abcc914315215fcd1bae11b1c751fd52443aac8f601087d8d42737c18a3fa11ecd4131ecae017ae0a14acfc4ef85b83c19fed33cfd1cd629da2c4c09e222b398e18d822f77bb378dea3cb360b605e5aa58b20edc29d000a66bd177c682a17e7eb12a63ef7c2e4183e0d898f3d6bf567ba8ae84f84f1d23bf8b8e261c3729e2fa6d07b832e07cddd1d14f55325c6f924267957121902dc19b3b32948bdead5',
  PREPARED_MSG:
    '8417e699b219d583fb6216ae0c53ca0e9723442d02f1d1a34295527e7d929e8b8f3dc6fb8c4a02f4d6352edf0907822c1210a9b32f9bdda4c45a698c80023aa6b59f8cfec5fdbb36331372ebefedae7d',
  INV: '80682c48982407b489d53d1261b19ec8627d02b8cda5336750b8cee332ae260de57b02d72609c1e0e9f28e2040fc65b6f02d56dbd6aa9af8fde656f70495dfb723ba01173d4707a12fddac628ca29f3e32340bd8f7ddb557cf819f6b01e445ad96f874ba235584ee71f6581f62d4f43bf03f910f6510deb85e8ef06c7f09d9794a008be7ff2529f0ebb69decef646387dc767b74939265fec0223aa6d84d2a8a1cc912d5ca25b4e144ab8f6ba054b54910176d5737a2cff011da431bd5f2a0d2d66b9e70b39f4b050e45c0d9c16f02deda9ddf2d00f3e4b01037d7029cd49c2d46a8e1fc2c0c17520af1f4b5e25ba396afc4cd60c494a4c426448b35b49635b337cfb08e7c22a39b256dd032c00adddafb51a627f99a0e1704170ac1f1912e49d9db10ec04c19c58f420212973e0cb329524223a6aa56c7937c5dffdb5d966b6cd4cbc26f3201dd25c80960a1a111b32947bb78973d269fac7f5186530930ed19f68507540eed9e1bab8b00f00d8ca09b3f099aae46180e04e3584bd7ca054df18a1504b89d1d1675d0966c4ae1407be325cdf623cf13ff13e4a28b594d59e3eadbadf6136eee7a59d6a444c9eb4e2198e8a974f27a39eb63af2c9af3870488b8adaad444674f512133ad80b9220e09158521614f1faadfe8505ef57b7df6813048603f0dd04f4280177a11380fbfc861dbcbd7418d62155248dad5fdec0991f',
  BLIND_SIG:
    '3f4a79eacd4445fca628a310d41e12fcd813c4d43aa4ef2b81226953248d6d00adfee6b79cb88bfa1f99270369fd063c023e5ed546719b0b2d143dd1bca46b0e0e615fe5c63d95c5a6b873b8b50bc52487354e69c3dfbf416e7aca18d5842c89b676efdd38087008fa5a810161fcdec26f20ccf2f1e6ab0f9d2bb93e051cb9e86a9b28c5bb62fd5f5391379f887c0f706a08bcc3b9e7506aaf02485d688198f5e22eefdf837b2dd919320b17482c5cc54271b4ccb41d267629b3f844fd63750b01f5276c79e33718bb561a152acb2eb36d8be75bce05c9d1b94eb609106f38226fb2e0f5cd5c5c39c59dda166862de498b8d92f6bcb41af433d65a2ac23da87f39764cb64e79e74a8f4ce4dd567480d967cefac46b6e9c06434c3715635834357edd2ce6f105eea854ac126ccfa3de2aac5607565a4e5efaac5eed491c335f6fc97e6eb7e9cea3e12de38dfb315220c0a3f84536abb2fdd722813e083feda010391ac3d8fd1cd9212b5d94e634e69ebcc800c4d5c4c1091c64afc37acf563c7fc0a6e4c082bc55544f50a7971f3fb97d5853d72c3af34ffd5ce123998be5360d1059820c66a81e1ee6d9c1803b5b62af6bc877526df255b6d1d835d8c840bebbcd6cc0ee910f17da37caf8488afbc08397a1941fcc79e76a5888a95b3d5405e13f737bea5c78d716a48eb9dc0aec8de39c4b45c6914ad4a8185969f70b1adf46',
  SIG: '191e941c57510e22d29afad257de5ca436d2316221fe870c7cb75205a6c071c2735aed0bc24c37f3d5bd960ab97a829a508f966bbaed7a82645e65eadaf24ab5e6d9421392c5b15b7f9b640d34fec512846a3100b80f75ef51064602118c1a77d28d938f6efc22041d60159a518d3de7c4d840c9c68109672d743d299d8d2577ef60c19ab463c716b3fa75fa56f5735349d414a44df12bf0dd44aa3e10822a651ed4cb0eb6f47c9bd0ef14a034a7ac2451e30434d513eb22e68b7587a8de9b4e63a059d05c8b22c7c51e2cfee2d8bef511412e93c859a13726d87c57d1bc4c2e68ab121562f839c3a3d233e87ed63c69b7e57525367753fbebcc2a9805a2802659f5888b2c69115bf865559f10d906c09d048a0d71bfee4b33857393ec2b69e451433496d02c9a7910abb954317720bbde9e69108eafc3e90bad3d5ca4066d7b1e49013fa04e948104a1dd82b12509ecb146e948c54bd8bfb5e6d18127cd1f7a93c3cf9f2d869d5a78878c03fe808a0d799e910be6f26d18db61c485b303631d3568368fc41986d08a95ea6ac0592240c19d7b22416b9c82ae6241e211dd5610d0baaa9823158f9c32b66318f5529491b7eeadcaa71898a63bac9d95f4aa548d5e97568d744fc429104e32edd9c87519892a198a30d333d427739ffb9607b092e910ae37771abf2adb9f63bc058bf58062ad456cb934679795bbdfcdfad5e0f2',
};
export async function runKilojoinNativeSelfTest(): Promise<void> {
  runKilojoinV5SelfTest();
  const pk = publicKey(vector.N + ':10001');
  if (
    finalize(pk, Buffer.from(vector.PREPARED_MSG, 'hex'), Buffer.from(vector.BLIND_SIG, 'hex'), BigInt('0x' + vector.INV)).toString(
      'hex',
    ) !== vector.SIG
  )
    throw new Error('Native blind signature vector failed');
  const outputs = Array.from({ length: 5 }, (_, i) => {
    const script = '0014' + (i + 1).toString(16).repeat(40);
    const prepared = prepare(Buffer.from(script, 'hex'), nativeEntropy);
    const result = blind(pk, prepared, nativeEntropy);
    return { script, prepared: prepared.toString('hex'), blinded: result.blinded.toString('hex'), inverse: result.inv.toString(16) };
  });
  if (new Set(outputs.map(o => o.prepared.slice(0, 64))).size !== 5 || new Set(outputs.map(o => o.blinded)).size !== 5)
    throw new Error('Native output entropy repeated');
  const poolId = Buffer.from(nativeEntropy(16)).toString('hex');
  const walletId = 'kilojoin-native-selftest';
  const service = 'redwallet.kilojoin.v1.' + utf8Hash(JSON.stringify([walletId, poolId])).toString('hex');
  const vault = new SessionVault(walletId, poolId);
  const state: SessionState = { phase: 'closing', sequence: 1, seats: [], signatures: {}, deadline: 9999999999, outputStates: outputs };
  try {
    await vault.save(state);
    if (JSON.stringify(await vault.load()) !== JSON.stringify(state)) throw new Error('Native session persistence failed');
    const encoded = await AsyncStorage.getItem(service);
    if (!encoded || outputs.some(o => encoded.includes(o.prepared) || encoded.includes(o.inverse)))
      throw new Error('Native session plaintext leaked');
    const envelope = JSON.parse(encoded);
    envelope.ciphertext = (envelope.ciphertext.startsWith('00') ? '01' : '00') + envelope.ciphertext.slice(2);
    await AsyncStorage.setItem(service, JSON.stringify(envelope));
    let rejected = false;
    try {
      await vault.load();
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error('Native session accepted tampering');
  } finally {
    await AsyncStorage.removeItem(service);
    await Keychain.resetGenericPassword({ service });
  }
  await runKilojoinStartupSelfTest();
}

// Run from the private operator directory after configure-canister.mjs.
// This probe uses an anonymous identity and never reads the bridge secret.
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';

const canisterId = process.argv[2];
if (!canisterId) throw new Error('Usage: node verify-canister.mjs CANISTER_ID');
Principal.fromText(canisterId);

const checkpointHeight = 961640n;
const checkpointHash = '0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb';
// Published BIP84 vector, not a user's private wallet address.
const address = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const idlFactory = ({ IDL }) => {
  const error = IDL.Variant({
    not_configured: IDL.Null,
    malformed_response: IDL.Text,
    invalid_input: IDL.Text,
    backend_unavailable: IDL.Text,
  });
  const result = (type) => IDL.Variant({ ok: type, err: error });
  return IDL.Service({
    getBridgeStatus: IDL.Func([], [IDL.Record({ configured: IDL.Bool, checkpointConfigured: IDL.Bool })], ['query']),
    getServerStatus: IDL.Func([], [result(IDL.Record({
      height: IDL.Int, protocolVersion: IDL.Text, serverVersion: IDL.Text,
      checkpointConfigured: IDL.Bool, checkpointHeight: IDL.Opt(IDL.Nat),
      checkpointHash: IDL.Opt(IDL.Text),
    }))], []),
    getAddressBalance: IDL.Func([IDL.Text], [result(IDL.Record({ confirmed: IDL.Nat, unconfirmed: IDL.Int }))], []),
    getAddressHistory: IDL.Func([IDL.Text], [result(IDL.Record({ entries: IDL.Vec(IDL.Record({
      height: IDL.Int, txid: IDL.Text, value: IDL.Opt(IDL.Int),
    })) }))], []),
    getFeeEstimate: IDL.Func([], [result(IDL.Record({ satoshisPerKb: IDL.Nat }))], []),
  });
};

function unwrap(method, response) {
  if (!Object.hasOwn(response, 'ok')) {
    const category = Object.keys(response.err ?? {})[0] ?? 'unknown';
    throw new Error(`${method} failed: ${category}`);
  }
  return response.ok;
}

try {
  const agent = await HttpAgent.create({ host: 'https://icp-api.io' });
  const actor = Actor.createActor(idlFactory, { agent, canisterId });
  const config = await actor.getBridgeStatus();
  if (!config.configured) throw new Error('Bridge is not configured');
  const status = unwrap('getServerStatus', await actor.getServerStatus());
  if (!status.checkpointConfigured || status.checkpointHeight[0] !== checkpointHeight ||
      status.checkpointHash[0] !== checkpointHash || status.height < checkpointHeight) {
    throw new Error('XBT checkpoint verification failed');
  }
  // Sequential calls keep the probe within the deployed concurrency quota.
  const balance = unwrap('getAddressBalance', await actor.getAddressBalance(address));
  const history = unwrap('getAddressHistory', await actor.getAddressHistory(address));
  const fees = unwrap('getFeeEstimate', await actor.getFeeEstimate());
  if (balance.confirmed < 0n || fees.satoshisPerKb < 0n || fees.satoshisPerKb > 10_000_000_000n ||
      history.entries.some((entry) => !/^[a-fA-F0-9]{64}$/.test(entry.txid) || entry.height < -1n)) {
    throw new Error('Canister returned invalid read data');
  }
  console.log(JSON.stringify({
    verifiedAt: new Date().toISOString(), canisterId, address,
    status, balance, historyCount: history.entries.length, fees,
  }, (_, value) => typeof value === 'bigint' ? value.toString() : value));
} catch (error) {
  // Avoid dumping transport headers or request objects into operator logs.
  console.error(error instanceof Error ? error.message.split('\n')[0] : 'Canister verification failed');
  process.exitCode = 1;
}

// Run from the private operator directory on Umbrel. Never copy the identity
// or .env file to GitHub, Caffeine prompts, or browser storage.
import fs from 'node:fs';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { Ed25519KeyIdentity } from '@icp-sdk/core/identity';

const canisterId = process.argv[2];
const baseUrl = process.argv[3];
if (!canisterId || !baseUrl?.startsWith('https://')) {
  throw new Error('Usage: node configure-canister.mjs CANISTER_ID HTTPS_BRIDGE_BASE_URL');
}
const identity = Ed25519KeyIdentity.fromJSON(fs.readFileSync('operator-identity.json', 'utf8'));
const secretLine = fs.readFileSync('../.env', 'utf8').split('\n').find(line => line.startsWith('BRIDGE_SECRET='));
if (!secretLine) throw new Error('Bridge secret is absent from private deployment file');
const secret = secretLine.slice('BRIDGE_SECRET='.length);
const agent = await HttpAgent.create({ identity, host: 'https://icp-api.io' });
const idlFactory = ({ IDL }) => IDL.Service({
  setBridgeConfig: IDL.Func([IDL.Text, IDL.Text], [], []),
  getBridgeStatus: IDL.Func([], [IDL.Record({ configured: IDL.Bool, checkpointConfigured: IDL.Bool })], ['query']),
});
const actor = Actor.createActor(idlFactory, { agent, canisterId });
await actor.setBridgeConfig(baseUrl, secret);
const status = await actor.getBridgeStatus();
console.log(JSON.stringify({ configured: status.configured, checkpointConfigured: status.checkpointConfigured }));

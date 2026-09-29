// Anonymous probe: public status and malformed bytes only. Never submits a signed transaction.
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
const canisterId=process.argv[2];
Principal.fromText(canisterId);
const idlFactory=({IDL})=>{
 const err=IDL.Variant({not_configured:IDL.Null,malformed_response:IDL.Text,invalid_input:IDL.Text,backend_unavailable:IDL.Text});
 const result=t=>IDL.Variant({ok:t,err});
 return IDL.Service({
  getServerStatus:IDL.Func([],[result(IDL.Record({height:IDL.Int,serverVersion:IDL.Text,protocolVersion:IDL.Text,checkpointConfigured:IDL.Bool,checkpointHeight:IDL.Opt(IDL.Nat),checkpointHash:IDL.Opt(IDL.Text),broadcastEnabled:IDL.Opt(IDL.Bool)}))],[]),
  broadcastSignedTransaction:IDL.Func([IDL.Text,IDL.Text],[result(IDL.Record({txid:IDL.Text,outcome:IDL.Text}))],[]),
 });
};
try{
 const agent=await HttpAgent.create({host:'https://icp-api.io'});
 const actor=Actor.createActor(idlFactory,{agent,canisterId});
 const response=await actor.getServerStatus();
 if(!response.ok)throw Error('Status failed');
 const s=response.ok;
 if(!s.checkpointConfigured||s.checkpointHeight[0]!==961640n||s.checkpointHash[0]!=='0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb'||s.broadcastEnabled.length!==1)throw Error('Capability or checkpoint not verified');
 const invalid=await actor.broadcastSignedTransaction('not-hex','a'.repeat(64));
 if(!invalid.err||!Object.hasOwn(invalid.err,'invalid_input'))throw Error('Invalid input not rejected');
 console.log(JSON.stringify({canisterId,height:String(s.height),broadcastEnabled:s.broadcastEnabled[0],checkpointVerified:true,invalidInputRejected:true,verifiedAt:new Date().toISOString()}));
}catch(e){console.error(e instanceof Error?e.message.split('\n')[0]:'Verification failed');process.exitCode=1;}

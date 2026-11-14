// Read-only public-chain exercise. No wallet, keys, PSBT, signing or broadcast.
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const ts = require(path.join(root, 'node_modules/typescript'));
require.extensions['.ts'] = (m, filename) => m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const { Transaction } = require(path.join(root, 'node_modules/bitcoinjs-lib'));
const { verifyPublicFundingSeparation } = require(path.join(root, 'class/xbt/separation-service.ts'));
async function get(p) { const r=await fetch('https://blockstream.info/api'+p,{signal:AbortSignal.timeout(12000)}); if(!r.ok) throw Error('HTTP '+r.status); return (await r.text()).trim(); }
(async () => {
 const tip = Number(await get('/blocks/tip/height'));
 const height = tip-8;
 const block = await get('/block-height/'+height);
 const txid = await get('/block/'+block+'/txid/1');
 const raw = await get('/tx/'+txid+'/hex');
 const conflict = Transaction.fromHex(raw);
 const funding = new Transaction();
 // Hypothetical competing body. This tests evidence transport/inclusion only;
 // it does not claim this synthetic transaction is valid on XBT.
 funding.addInput(conflict.ins[0].hash,conflict.ins[0].index);
 funding.addOutput(Buffer.from('0014'+'02'.repeat(20),'hex'),1000n);
 await verifyPublicFundingSeparation([funding],()=>{});
 const result={observedAt:new Date().toISOString(),purpose:'public read-only explorer proof integration; NOT an XBT wallet or node acceptance test',height,block,conflictTxid:txid,result:'passed'};

 console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1});

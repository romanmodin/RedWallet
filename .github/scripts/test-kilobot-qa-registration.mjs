import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureRegistration } from "./kilobot-qa-registration.mjs";

const bundle = "dev.kilowallet.tests.KilobotWallet";
const existing = {type:"bundleIds",id:"QATEST",attributes:{identifier:bundle,platform:"IOS",seedId:"PPG9C98EY9"}};
function apple({registered=false, conflict=false, other=false} = {}) {
  const writes=[];
  const request=async (path,body)=>{
    if (path==="/v1/apps/6824331953") return {data:{id:"6824331953",attributes:{bundleId:"com.kilombino.kilowallet"}}};
    if (path==="/v1/apps?filter%5BbundleId%5D="+bundle+"&limit=2") return {data:[]};
    if (path==="/v1/bundleIds?filter%5Bidentifier%5D="+bundle+"&limit=2")
      return {data:registered?[existing]:other?[{...existing,attributes:{...existing.attributes,identifier:"com.example.other"}}]:[]};
    assert.equal(path,"/v1/bundleIds");
    assert.deepEqual(body,{data:{type:"bundleIds",attributes:{identifier:bundle,name:"Kilobot QA",platform:"IOS"}}});
    writes.push(body); registered=true;
    if (conflict) throw Object.assign(Error("Concurrent registration"),{status:409});
    return {data:existing};
  };
  return {request,writes};
}
test("inspect leaves missing identity alone",async()=>{const a=apple();assert.equal((await ensureRegistration(a.request)).registeredBundleId,null);assert.equal(a.writes.length,0);});
test("register and retry confirm a single write",async()=>{const a=apple();assert.equal((await ensureRegistration(a.request,true)).createdBundle,true);assert.equal((await ensureRegistration(a.request,true)).createdBundle,false);assert.equal(a.writes.length,1);});
test("concurrent registration verifies the identity",async()=>{const a=apple({conflict:true});assert.equal((await ensureRegistration(a.request,true)).registeredBundleId,"QATEST");});
test("unexpected match stops before registration",async()=>{const a=apple({other:true});await assert.rejects(ensureRegistration(a.request,true),/another app identity/);assert.equal(a.writes.length,0);});

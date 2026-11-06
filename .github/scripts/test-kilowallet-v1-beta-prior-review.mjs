import test from "node:test";
import assert from "node:assert/strict";
import { APP } from "./kilowallet-v1-beta-plan.mjs";
import { PRIOR_BUILD, PRIOR_PATH, readPriorReview } from "./kilowallet-v1-beta-prior-review.mjs";
import { clients } from "./kilowallet-v1-beta-client.mjs";
const rel=(type,id)=>({data:{type,id}});
function fixture(state="WAITING_FOR_REVIEW") {
  return { data: { type:"builds", id:PRIOR_BUILD, attributes:{version:"8"},
    relationships:{ app:rel("apps",APP),preReleaseVersion:rel("preReleaseVersions","train"),
      buildBetaDetail:rel("buildBetaDetails","detail"),
      betaAppReviewSubmission:rel("betaAppReviewSubmissions","review") }},
    included:[
      {type:"apps",id:APP,attributes:{bundleId:"com.kilombino.kilowallet"}},
      {type:"preReleaseVersions",id:"train",attributes:{version:"1.0.0",platform:"IOS"}},
      {type:"buildBetaDetails",id:"detail",attributes:{externalBuildState:
        state==="APPROVED"?"IN_BETA_TESTING":state==="IN_REVIEW"?"IN_BETA_REVIEW":"WAITING_FOR_BETA_REVIEW"}},
      {type:"betaAppReviewSubmissions",id:"review",attributes:{betaReviewState:state}}]};
}
test("both active review states block another build; only the fixed prior-build GET is read",async()=>{
  for(const state of ["WAITING_FOR_REVIEW","IN_REVIEW"]) {
    const calls=[]; const result=await readPriorReview(async path=>{
      calls.push(path);return fixture(state);
    });
    assert.deepEqual(calls,[PRIOR_PATH]);assert.equal(result.complete,true);
    assert.equal(result.readOnly,true);assert.equal(result.blocksAnotherBuildReview,true);
    assert.equal(result.reviewState,state);
  }
});
test("approved prior beta is distinguished from pending review",async()=>{
  assert.equal((await readPriorReview(async()=>fixture("APPROVED"))).blocksAnotherBuildReview,false);
});
test("explicit null review is accepted only with consistent beta state",async()=>{
  const b=fixture();b.data.relationships.betaAppReviewSubmission={data:null};
  b.included=b.included.filter(x=>x.type!=="betaAppReviewSubmissions");
  b.included[2].attributes.externalBuildState="READY_FOR_BETA_SUBMISSION";
  const result=await readPriorReview(async()=>b);
  assert.equal(result.reviewState,null);assert.equal(result.blocksAnotherBuildReview,false);
});
test("foreign app, build, version, platform or mismatched included resources fail closed",async()=>{
  for(const change of [
    b=>b.data.id="foreign",b=>b.data.attributes.version="10",
    b=>b.included[0].attributes.bundleId="foreign",
    b=>b.data.relationships.app.data.id="foreign",
    b=>b.included[1].attributes.version="0.4.0",
    b=>b.included[1].attributes.platform="MAC_OS",
    b=>b.included[2].id="foreign",b=>b.included.push(b.included[3]),
    b=>delete b.data.relationships.betaAppReviewSubmission,
    b=>b.included[3].attributes.betaReviewState="UNKNOWN",
    b=>b.included[2].attributes.externalBuildState="IN_BETA_TESTING",
  ]) { const b=fixture();change(b);await assert.rejects(readPriorReview(async()=>b)); }
});
test("diagnostic transport permits only exact scoped include and never writes",async()=>{
 const upload={uploadVerified:true,currentNativeGatesVerified:true,app:APP,marketingVersion:"1.0.0",
 signature:"verified",usesNonExemptEncryption:false,sourceCommit:"a".repeat(40),
 ipaSha256:"b".repeat(64),appleBuildId:"new-build",build:"10",runId:123,runAttempt:1};
 const requests=[];const c=clients("synthetic-token",upload,"notes",async()=>{},async(u,o)=>{
   requests.push({path:u.pathname+u.search,method:o.method});
   return {ok:true,status:200,json:async()=>fixture()};
 });
 assert.equal((await readPriorReview(c.get)).blocksAnotherBuildReview,true);
 assert.deepEqual(requests,[{path:PRIOR_PATH,method:"GET"}]);
 for(const path of [PRIOR_PATH.replace(PRIOR_BUILD,"foreign"),PRIOR_PATH+"&include=app",
   PRIOR_PATH.replace("include=app,preReleaseVersion,buildBetaDetail,betaAppReviewSubmission","include=app")])
   await assert.rejects(c.get(path));
 assert.equal(requests.length,1);
});

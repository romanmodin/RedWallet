import test from "node:test";
import assert from "node:assert/strict";
import {
  inspect,
  inspectRc7Processing,
  RC7_QUERY,
  failureSummary,
  readClient,
  APP,
  BUILD,
  STORE_VERSION,
} from "./inspect-kilowallet-store.mjs";
function fixture(missingAvailability = false) {
  return async (path) => {
    if (path.startsWith("/v1/builds?")) return {data:[]};
    if (path === "/v1/apps/" + APP)
      return {
        data: { id: APP, attributes: { bundleId: "com.kilombino.kilowallet" } },
      };
    if (path.includes("appEncryptionDeclarations?")) return { data: [] };
    if (path.includes("/betaGroups?")) return { data: [] };
    if (path.includes("/appStoreVersions?")) return { data: [{id:STORE_VERSION,attributes:{versionString:"1.0.0",platform:"IOS",appStoreState:"WAITING_FOR_REVIEW"}}] };
    if (path.includes("/appStoreVersions/")) return path.includes("Localizations") ? {data:[]} : {data:null};
    if (path.includes("/appInfos?")) return {data:[]};
    if (path.includes("/relationships/appAvailabilityV2"))
      return { data: null };
    if (path.endsWith("/appAvailabilityV2")) {
      if (missingAvailability) throw Error("unavailable");
      return {
        data: {
          id: "availability",
          attributes: { availableInNewTerritories: false },
        },
      };
    }
    if (path.includes("/territoryAvailabilities?"))
      return {
        data: [
          {
            attributes: { available: true },
            relationships: { territory: { data: { id: "USA" } } },
          },
        ],
      };
    if (path.startsWith("/v1/builds/"))
      return {
        data: {
          id: BUILD,
          attributes: {
            version: "3",
            processingState: "VALID",
            expired: false,
          },
          relationships: { app: { data: { id: APP } } },
        },
        included: [],
      };
    throw Error("Unexpected fixture path");
  };
}
test("an unavailable store setting cannot hide independent declarations, groups, versions or uploaded build", async () => {
  const r = await inspect(fixture(true));
  assert.equal(r.inspectionComplete, false);
  assert.equal(r.appStoreVersions[0].version, "1.0.0");
  assert.deepEqual(r.encryptionDeclarations, []);
  assert.equal(r.uploadedBuild.processingState, "VALID");
  assert.equal(r.errors[0].resource, "availability");
  assert.equal(r.availability, undefined);
});
test("complete known availability is reported without inventing a compliance determination", async () => {
  const r = await inspect(fixture());
  assert.equal(r.inspectionComplete, true);
  assert.deepEqual(r.availability.territories, ["USA"]);
  assert.equal(r.exportComplianceDeterminationVerified, undefined);
});
test("the client is structurally GET-only and rejects other apps, builds and hosts before credentials are sent", async () => {
  const calls = [];
  const get = readClient("fixture", async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ data: [] }) };
  });
  for (const path of [
    "/v1/apps/other/appInfos",
    "/v1/builds/other",
    "https://evil.invalid/v1/apps/" + APP + "/appInfos",
    "/v1/appEncryptionDeclarations?filter%5Bapp%5D=other",
  ])
    await assert.rejects(get(path), /Unexpected/);
  assert.equal(calls.length, 0);
  await get("/v1/apps/" + APP + "/appStoreVersions");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
});

test("review report retains qualification limits", async()=>{
 const r=await inspect(fixture()); assert.equal(r.publicReview.versionId, STORE_VERSION);
 assert.equal(r.publicReview.privacyQuestionnaireVerified,false);assert.equal(r.publicReview.screenshotPixelsReviewed,false);
});
test("child metadata routes require a returned parent and stay GET-only",async()=>{
 const calls=[];const get=readClient("fixture",async(url,options)=>{calls.push(options);return {ok:true,json:async()=>({data:url.pathname.endsWith("/appScreenshotSets")?[]:[{id:"locale1",type:"appStoreVersionLocalizations"}]})};});
 await assert.rejects(get("/v1/appStoreVersionLocalizations/locale1/appScreenshotSets"));
 await get(`/v1/appStoreVersions/${STORE_VERSION}/appStoreVersionLocalizations`);
 await get("/v1/appStoreVersionLocalizations/locale1/appScreenshotSets");
 assert.ok(calls.every(c=>c.method==="GET"));
 await assert.rejects(get("/v1/appStoreVersions/foreign/build"));
});


test("initial Apple HTTP failures retain status without response text or credentials", async () => {
  for (const status of [401, 403, 404, 429, 500, 503]) {
    const get = readClient("synthetic-secret", async () => ({
      ok: false, status,
      text: async () => "synthetic-secret unsafe response",
    }));
    let failure;
    try { await inspect(get); } catch (error) { failure = failureSummary(error, "app-identity"); }
    assert.deepEqual(failure, {stage:"app-identity",kind:"HTTPError",httpStatus:status});
    assert.ok(!JSON.stringify(failure).includes("synthetic-secret"));
  }
});
test("credential and network errors never disclose exception messages or fake HTTP status", () => {
  for (const stage of ["credentials", "app-identity"]) {
    const error = new Error("synthetic-secret"); error.status = 500;
    assert.deepEqual(failureSummary(error, stage),
      {stage, kind:"ReadOrRuntimeError", httpStatus:null});
  }
});


test("RC7 processing validates exact build/train and does not claim membership", async () => {
  const body = {data:[{type:"builds",id:"build30",attributes:{version:"30",processingState:"VALID",expired:false},
    relationships:{app:{data:{type:"apps",id:APP}},preReleaseVersion:{data:{type:"preReleaseVersions",id:"train"}}}}],
    included:[{type:"preReleaseVersions",id:"train",attributes:{version:"1.0.0",platform:"IOS"}}]};
  const result = await inspectRc7Processing(async () => body);
  assert.equal(result.processingState,"VALID");
  assert.equal(result.testerMembershipVerified,false);
  for (const mutate of [
    b=>b.data.push(b.data[0]), b=>b.links={next:"next"},
    b=>b.data[0].attributes.version="21", b=>b.data[0].relationships.app.data.id="foreign",
    b=>b.included=[], b=>b.included[0].attributes.platform="MAC_OS"
  ]) {
    const bad=structuredClone(body); mutate(bad);
    await assert.rejects(inspectRc7Processing(async()=>bad));
  }
  body.data[0].attributes.processingState="PROCESSING";
  assert.equal((await inspectRc7Processing(async()=>body)).processingState,"PROCESSING");
});
test("RC7 build query is GET-only and rejects changed scope", async () => {
  let calls=0;
  const get=readClient("synthetic",async(u,o)=>{
    calls++; assert.equal(o.method,"GET"); return {ok:true,json:async()=>({data:[]})};
  });
  const path="/v1/builds?"+new URLSearchParams(RC7_QUERY);
  await get(path);
  await assert.rejects(get(path.replace("30","31")));
  await assert.rejects(get(path+"&extra=1"));
  assert.equal(calls,1);
});

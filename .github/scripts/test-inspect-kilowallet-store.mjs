import test from "node:test";
import assert from "node:assert/strict";
import {
  inspect,
  readClient,
  APP,
  BUILD,
  STORE_VERSION,
} from "./inspect-kilowallet-store.mjs";
function fixture(missingAvailability = false) {
  return async (path) => {
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

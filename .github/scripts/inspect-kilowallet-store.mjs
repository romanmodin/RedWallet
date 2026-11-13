import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { makeToken } from "./inspect-ios-store.mjs";
export const APP = "6824331953",
  BUILD = "19c6e86c-079e-4022-9a11-a9ab4f23c3ba";
export const STORE_VERSION = "1ca23695-4563-4a0e-b20e-d1a6457f4f8b";
const ROOT = "https://api.appstoreconnect.apple.com";
class AppleReadError extends Error {
  constructor(status) {
    super("Apple read failed");
    this.status = status;
  }
}
export function readClient(token, request = fetch) {
  const discovered = new Set();
  return async (path) => {
    const url = new URL(path, ROOT);
    const allowed =
      url.origin === ROOT &&
      !url.username &&
      !url.password &&
      (discovered.has(url.pathname) ||
        ["build", "appStoreReviewDetail", "appStoreVersionLocalizations"].some(x => url.pathname === `/v1/appStoreVersions/${STORE_VERSION}/${x}`) ||
        url.pathname === "/v1/apps/" + APP ||
        url.pathname.startsWith("/v1/apps/" + APP + "/") ||
        url.pathname === "/v1/builds/" + BUILD ||
        (url.pathname === "/v1/appEncryptionDeclarations" &&
          url.searchParams.get("filter[app]") === APP) ||
        /^\/v2\/appAvailabilities\/[A-Za-z0-9-]+\/territoryAvailabilities$/.test(
          url.pathname,
        ));
    if (!allowed) throw Error("Unexpected read-only resource");
    const response = await request(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    });
    if (!response.ok) throw new AppleReadError(response.status);
    const body = await response.json();
    const children = url.pathname === `/v1/appStoreVersions/${STORE_VERSION}/appStoreVersionLocalizations` ? ["appStoreVersionLocalizations", "appScreenshotSets"]
      : url.pathname === `/v1/apps/${APP}/appInfos` ? ["appInfos", "appInfoLocalizations"]
      : discovered.has(url.pathname) && url.pathname.endsWith("/appScreenshotSets") ? ["appScreenshotSets", "appScreenshots"] : null;
    if (children && Array.isArray(body.data)) for (const item of body.data) {
      if (item.type !== children[0] || !/^[A-Za-z0-9-]+$/.test(item.id)) throw Error("Unexpected child identity");
      discovered.add(`/v1/${children[0]}/${item.id}/${children[1]}`);
    }
    return body;
  };
}
export async function collection(get, path) {
  const values = [],
    seen = new Set();
  for (let page = 0; page < 5; page++) {
    if (seen.has(path)) throw Error("Cyclic pagination");
    seen.add(path);
    const body = await get(path);
    if (!Array.isArray(body.data)) throw Error("Incomplete collection");
    values.push(...body.data);
    const next = body.links?.next;
    if (!next) return values;
    const url = new URL(next, ROOT);
    if (url.origin !== ROOT) throw Error("Unexpected pagination host");
    path = url.pathname + url.search;
  }
  throw Error("Incomplete collection");
}
const declarationSummary = (d) => ({
  id: d.id,
  ...Object.fromEntries(
    [
      "appDescription",
      "usesEncryption",
      "exempt",
      "containsProprietaryCryptography",
      "containsThirdPartyCryptography",
      "availableOnFrenchStore",
      "appEncryptionDeclarationState",
      "codeValue",
    ].map((k) => [k, d.attributes?.[k]]),
  ),
});
export async function inspect(get) {
  const report = {
    appId: APP,
    buildId: BUILD,
    mode: "read-only",
    observedAt: new Date().toISOString(),
    errors: [],
  };
  const app = (await get("/v1/apps/" + APP)).data;
  if (
    app?.id !== APP ||
    app.attributes?.bundleId !== "com.kilombino.kilowallet"
  )
    throw Error("Wrong app identity");
  report.app = { id: app.id, bundleId: app.attributes.bundleId };
  async function observe(name, action) {
    try {
      report[name] = await action();
    } catch (error) {
      report.errors.push({
        resource: name,
        httpStatus: error instanceof AppleReadError ? error.status : null,
        kind: error instanceof AppleReadError ? "HTTPError" : "ReadError",
      });
    }
  }
  await observe("publicReview", async () => {
    const versions = await collection(get, `/v1/apps/${APP}/appStoreVersions?limit=200`);
    const version = versions.find(v => v.id === STORE_VERSION);
    if (version?.attributes?.versionString !== "1.0.0" || version.attributes.platform !== "IOS") throw Error("Wrong store version");
    const prefix = `/v1/appStoreVersions/${STORE_VERSION}`;
    const build = (await get(prefix + "/build")).data;
    const details = (await get(prefix + "/appStoreReviewDetail")).data;
    const locales = await collection(get, prefix + "/appStoreVersionLocalizations?limit=200");
    const listing = [];
    for (const loc of locales) {
      const sets = await collection(get, `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=200`);
      const screenshots = [];
      for (const set of sets) {
        const images = await collection(get, `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=200`);
        screenshots.push({id:set.id, displayType:set.attributes?.screenshotDisplayType, images:images.map(i => ({id:i.id, fileName:i.attributes?.fileName, checksum:i.attributes?.sourceFileChecksum, state:i.attributes?.assetDeliveryState?.state}))});
      }
      listing.push({id:loc.id, ...Object.fromEntries(["locale","description","keywords","supportUrl","marketingUrl","whatsNew","promotionalText"].map(k=>[k,loc.attributes?.[k] ?? null])), screenshots});
    }
    const infos = await collection(get, `/v1/apps/${APP}/appInfos?limit=200`);
    const policies = [];
    for (const info of infos) {
      const locs = await collection(get, `/v1/appInfos/${info.id}/appInfoLocalizations?limit=200`);
      policies.push({id:info.id, state:info.attributes?.appStoreState, localizations:locs.map(l=>({id:l.id,locale:l.attributes?.locale,privacyPolicyUrl:l.attributes?.privacyPolicyUrl}))});
    }
    return {versionId:STORE_VERSION,state:version.attributes.appStoreState,releaseType:version.attributes.releaseType,
      selectedBuild:build ? {id:build.id,build:build.attributes?.version,processingState:build.attributes?.processingState}:null,
      review:{id:details?.id,notes:details?.attributes?.notes ?? null,demoAccountRequired:details?.attributes?.demoAccountRequired ?? null,contactComplete:["contactFirstName","contactLastName","contactEmail","contactPhone"].every(k=>Boolean(details?.attributes?.[k]))},
      listing,policies,privacyQuestionnaireVerified:false,screenshotPixelsReviewed:false};
  });
  await observe("encryptionDeclarations", async () =>
    (
      await collection(
        get,
        "/v1/appEncryptionDeclarations?filter%5Bapp%5D=" + APP + "&limit=200",
      )
    ).map(declarationSummary),
  );
  await observe("betaGroups", async () =>
    (await collection(get, "/v1/apps/" + APP + "/betaGroups?limit=200")).map(
      (d) => ({
        id: d.id,
        name: d.attributes.name,
        isInternalGroup: d.attributes.isInternalGroup,
      }),
    ),
  );
  await observe("appStoreVersions", async () =>
    (
      await collection(get, "/v1/apps/" + APP + "/appStoreVersions?limit=200")
    ).map((d) => ({
      id: d.id,
      version: d.attributes.versionString,
      platform: d.attributes.platform,
      state: d.attributes.appStoreState,
    })),
  );
  await observe(
    "availabilityRelationship",
    async () =>
      (await get("/v1/apps/" + APP + "/relationships/appAvailabilityV2")).data,
  );
  await observe("availability", async () => {
    const a = (await get("/v1/apps/" + APP + "/appAvailabilityV2")).data;
    if (!a?.id || !/^[A-Za-z0-9-]+$/.test(a.id))
      throw Error("Unexpected availability identity");
    const territories = await collection(
      get,
      "/v2/appAvailabilities/" +
        a.id +
        "/territoryAvailabilities?include=territory&limit=200",
    );
    return {
      id: a.id,
      availableInNewTerritories: a.attributes.availableInNewTerritories,
      territories: territories
        .filter((t) => t.attributes.available)
        .map((t) => t.relationships.territory.data.id)
        .sort(),
    };
  });
  await observe("uploadedBuild", async () => {
    const body = await get(
      "/v1/builds/" +
        BUILD +
        "?include=app,preReleaseVersion,appEncryptionDeclaration,betaGroups,buildBetaDetail",
    );
    if (
      body.data?.id !== BUILD ||
      body.data.relationships?.app?.data?.id !== APP
    )
      throw Error("Wrong build app");
    const b = body.data;
    return {
      id: b.id,
      build: b.attributes.version,
      processingState: b.attributes.processingState,
      expired: b.attributes.expired,
      usesNonExemptEncryption: b.attributes.usesNonExemptEncryption,
      relationships: b.relationships,
      included: (body.included || [])
        .filter((d) =>
          [
            "preReleaseVersions",
            "buildBetaDetails",
            "appEncryptionDeclarations",
            "betaGroups",
          ].includes(d.type),
        )
        .map((d) => ({
          id: d.id,
          type: d.type,
          attributes:
            d.type === "betaGroups"
              ? {
                  name: d.attributes.name,
                  isInternalGroup: d.attributes.isInternalGroup,
                }
              : d.type === "appEncryptionDeclarations"
                ? declarationSummary(d)
                : d.attributes,
        })),
    };
  });
  report.inspectionComplete = report.errors.length === 0;
  return report;
}
async function main() {
  let report = { mode: "read-only", appId: APP, inspectionComplete: false };
  try {
    if (process.env.TEAM_ID !== "PPG9C98EY9") throw Error("Wrong team");
    const credential = JSON.parse(
      process.env.APP_STORE_CONNECT_API_KEY_CONTENT || "",
    );
    delete process.env.APP_STORE_CONNECT_API_KEY_CONTENT;
    report = await inspect(readClient(makeToken(credential)));
    if (!report.inspectionComplete) process.exitCode = 1;
  } catch {
    report.error = "Read-only inspection incomplete; no changes made";
    process.exitCode = 1;
  } finally {
    writeFileSync(
      "kilowallet-apple-preflight.json",
      JSON.stringify(report, null, 2) + String.fromCharCode(10),
      { mode: 0o600 },
    );
    console.log(JSON.stringify(report, null, 2));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();

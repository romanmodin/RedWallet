import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { APP_ID, BUNDLE_ID, makeToken } from "./inspect-ios-store.mjs";

const ORIGIN = "https://api.appstoreconnect.apple.com";
const allowed = /^\/v1\/(?:apps\/6817118871(?:\/betaGroups)?|builds(?:\/[A-Za-z0-9-]+)?|betaGroups\/[A-Za-z0-9-]+\/builds)$/;
const identity = (x) => {
  if (!x || !/^[A-Za-z0-9-]+$/.test(x.id)) throw Error("Invalid Apple resource identity");
  return x.id;
};
const text = (x) => typeof x === "string" ? x.slice(0, 200) : null;

export function reader(token, request = fetch) {
  return async (path, query = {}) => {
    if (!allowed.test(path) || (path === "/v1/builds" && query["filter[app]"] !== APP_ID))
      throw Error("Unexpected Apple resource");
    const url = new URL(path, ORIGIN);
    url.search = new URLSearchParams(query).toString();
    const response = await request(url, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { Authorization: "Bearer " + token, Accept: "application/json" }
    });
    if (!response.ok) throw Error("Apple read failed: HTTP " + response.status);
    const result = await response.json();
    if (result.links?.next && !(path === "/v1/builds" && query.sort === "-uploadedDate" && query.limit === "5")) throw Error("Incomplete Apple response");
    return result;
  };
}

export async function inspect(get, now = new Date().toISOString()) {
  const app = (await get("/v1/apps/" + APP_ID)).data;
  if (identity(app) !== APP_ID || app.attributes?.bundleId !== BUNDLE_ID)
    throw Error("Wrong Apple app identity");
  const groups = (await get("/v1/apps/" + APP_ID + "/betaGroups", { limit: "200" })).data;
  const recent = (await get("/v1/builds", {
    "filter[app]": APP_ID, sort: "-uploadedDate", limit: "5"
  })).data;
  const cache = new Map();
  const buildInfo = async (build) => {
    const id = identity(build);
    if (cache.has(id)) return cache.get(id);
    const response = await get("/v1/builds/" + id, {
      include: "buildBetaDetail,betaAppReviewSubmission,betaGroups,preReleaseVersion"
    });
    const resource = response.data;
    if (identity(resource) !== id) throw Error("Wrong Apple resource identity");
    const included = response.included || [];
    const detail = included.find((x) => x.type === "buildBetaDetails")?.attributes || {};
    const review = included.find((x) => x.type === "betaAppReviewSubmissions")?.attributes || {};
    const version = included.find((x) => x.type === "preReleaseVersions")?.attributes || {};
    const a = resource.attributes || {};
    const result = {
      id, build: text(a.version), version: text(version.version), platform: text(version.platform),
      uploadedDate: text(a.uploadedDate), processingState: text(a.processingState),
      expired: a.expired === true, expirationDate: text(a.expirationDate), minOsVersion: text(a.minOsVersion),
      internalBuildState: text(detail.internalBuildState), externalBuildState: text(detail.externalBuildState),
      betaReviewState: text(review.betaReviewState),
      groups: included.filter((x) => x.type === "betaGroups").map((g) => ({
        id: identity(g), name: text(g.attributes?.name), internal: g.attributes?.isInternalGroup === true
      }))
    };
    cache.set(id, result);
    return result;
  };
  const latestBuilds = [];
  for (const build of recent) latestBuilds.push(await buildInfo(build));
  const groupReports = [];
  for (const group of groups) {
    const id = identity(group), a = group.attributes || {};
    const builds = (await get("/v1/betaGroups/" + id + "/builds", { limit: "200" })).data;
    const latest = [...builds].sort((x, y) => String(y.attributes?.uploadedDate || "").localeCompare(String(x.attributes?.uploadedDate || ""))).slice(0, 5);
    const buildReports = [];
    for (const build of latest) buildReports.push(await buildInfo(build));
    const publicLink = typeof a.publicLink === "string" && /^https:\/\/testflight\.apple\.com\/join\/[A-Za-z0-9]+$/.test(a.publicLink) ? a.publicLink : null;
    groupReports.push({
      id, name: text(a.name), internal: a.isInternalGroup === true,
      publicLinkEnabled: a.publicLinkEnabled === true, publicLink,
      publicLinkLimitEnabled: a.publicLinkLimitEnabled === true,
      publicLinkLimit: Number.isSafeInteger(a.publicLinkLimit) ? a.publicLinkLimit : null,
      assignedBuildCount: builds.length, latestBuilds: buildReports
    });
  }
  return {
    appId: APP_ID, bundleId: BUNDLE_ID, checkedAt: now, latestBuilds, groups: groupReports,
    recentBuildLimit: 5, readOnly: true, testerIdentitiesRequested: false, changedGroups: false, submittedReview: false
  };
}
async function main() {
  try {
    const config = JSON.parse(process.env.APP_STORE_CONNECT_API_KEY_CONTENT || "");
    const report = await inspect(reader(makeToken(config)));
    writeFileSync("ios-testflight-readiness.json", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } catch (error) {
    const safe = /^(Existing Apple API credential configuration is invalid|Unexpected Apple resource|Apple read failed: HTTP \d+|Incomplete Apple response|Invalid Apple resource identity|Wrong Apple resource identity|Wrong Apple app identity)$/;
    process.stderr.write((safe.test(error.message) ? error.message : "Read-only TestFlight inspection failed") + "\n");
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

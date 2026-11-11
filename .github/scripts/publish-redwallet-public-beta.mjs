import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { makeToken } from "./inspect-ios-store.mjs";

export const RELEASE = Object.freeze({
  app: "6817118871", bundle: "com.romanmodin.redwallet",
  version: "8.0.1", build: "1794365227",
  appleBuild: "ea4205f3-35dd-4a31-a539-640215158b94",
  group: "463ff340-3283-4f17-949d-39c7aa929da2",
  groupName: "RedWallet Early Testers",
  publicLink: "https://testflight.apple.com/join/UuExh5RP",
  source: "260e2431114a14469566b91359bfc51dca89192c",
  orchestration: "1ec93cacbfb65e7db28678372507d6fd9a62bd88",
  uploadRun: "42947673301",
  ipa: "5fcc96e3ac8b53206be60b4f2695a110dffa5ec2b571e44e81ab5510d13c23dc"
});
const buildPath = "/v1/builds/" + RELEASE.appleBuild;
const appGroupsPath = "/v1/apps/" + RELEASE.app + "/betaGroups";
const assert = (condition, message) => { if (!condition) throw Error(message); };
const id = (value) => {
  assert(typeof value === "string" && /^[A-Za-z0-9-]+$/.test(value), "Invalid Apple resource identity");
  return value;
};

export function apiClient(token, request = fetch) {
  return async (method, path, query = {}, payload) => {
    const allowed = method === "GET"
      ? ["/v1/apps/" + RELEASE.app, appGroupsPath, buildPath, buildPath + "/betaBuildLocalizations"].includes(path) ||
        (path === "/v1/builds" && query["filter[app]"] === RELEASE.app && query["filter[version]"] === RELEASE.build)
      : method === "POST"
        ? [buildPath + "/relationships/betaGroups", "/v1/betaAppReviewSubmissions", "/v1/buildBetaNotifications"].includes(path)
        : method === "PATCH" && /^\/v1\/buildBetaDetails\/[A-Za-z0-9-]+$/.test(path);
    assert(allowed, "Unexpected Apple operation");
    const url = new URL(path, "https://api.appstoreconnect.apple.com");
    url.search = new URLSearchParams(query).toString();
    const response = await request(url, {
      method, redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { Authorization: "Bearer " + token, Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json" } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
    assert(response.ok, "Apple operation failed: HTTP " + response.status + " (" + method + " " + path + ")");
    const result = response.status === 204 ? {} : await response.json();
    assert(!result.links?.next, "Incomplete Apple response");
    return result;
  };
}

export function verifyReceipt(receipt, uploadRun) {
  assert(uploadRun === RELEASE.uploadRun, "Wrong uploaded release");
  const expected = {
    publicSourceCommit: RELEASE.source, sourceCommit: RELEASE.source,
    orchestrationCommit: RELEASE.orchestration, ipaSha256: RELEASE.ipa,
    lightningNetwork: "mainnet", signatureVerification: "passed",
    sourceMappingVerification: "passed"
  };
  assert(Object.entries(expected).every(([k, v]) => receipt[k] === v), "Wrong uploaded package receipt");
  assert(receipt.bundles?.length === 2 &&
    new Set(receipt.bundles.map(x => x.bundleId)).size === 2 &&
    receipt.bundles.every(x => [RELEASE.bundle, RELEASE.bundle + ".Stickers"].includes(x.bundleId) &&
      x.build === RELEASE.build && x.version === RELEASE.version &&
      JSON.stringify(x.architectures) === '["arm64"]'), "Wrong uploaded bundle");
}

function snapshot(response) {
  const build = response.data, included = response.included || [];
  assert(build?.id === RELEASE.appleBuild && build.type === "builds" &&
    build.attributes?.version === RELEASE.build, "Wrong Apple build identity");
  assert(build.attributes.processingState === "VALID" && build.attributes.expired === false,
    "Build is not valid for testing");
  assert(build.attributes.usesNonExemptEncryption === false, "Existing export compliance requires attention");
  assert(build.attributes.buildAudienceType !== "INTERNAL_ONLY", "Build is internal only");
  const version = included.find(x => x.type === "preReleaseVersions");
  assert(version?.id === build.relationships?.preReleaseVersion?.data?.id &&
    version.attributes?.version === RELEASE.version && version.attributes?.platform === "IOS", "Wrong marketing version");
  const detail = included.find(x => x.type === "buildBetaDetails");
  assert(detail?.id === build.relationships?.buildBetaDetail?.data?.id, "Missing build beta detail");
  id(detail.id);
  const reviews = included.filter(x => x.type === "betaAppReviewSubmissions");
  assert(reviews.length <= 1, "Ambiguous beta review");
  const review = reviews[0];
  if (review) assert(review.id === build.relationships?.betaAppReviewSubmission?.data?.id, "Wrong beta review identity");
  return {
    processingState: build.attributes.processingState,
    internalBuildState: detail.attributes?.internalBuildState,
    externalBuildState: detail.attributes?.externalBuildState,
    autoNotifyEnabled: detail.attributes?.autoNotifyEnabled === true,
    detailId: detail.id,
    betaReviewState: review?.attributes?.betaReviewState || null,
    reviewId: review?.id || null,
    groupAssigned: included.some(x => x.type === "betaGroups" && x.id === RELEASE.group)
  };
}

export async function publish(api, receipt, uploadRun, save = () => {}) {
  verifyReceipt(receipt, uploadRun);
  const report = { appId: RELEASE.app, build: RELEASE.build, version: RELEASE.version,
    appleBuildId: RELEASE.appleBuild, groupId: RELEASE.group, publicLink: RELEASE.publicLink,
    uploadRunId: RELEASE.uploadRun, sourceCommit: RELEASE.source, ipaSha256: RELEASE.ipa,
    operations: [], status: "CHECKING" };
  const record = (status, state) => {
    Object.assign(report, state || {}, { status, checkedAt: new Date().toISOString() });
    save(structuredClone(report));
  };
  const info = async () => snapshot(await api("GET", buildPath, {
    include: "buildBetaDetail,betaAppReviewSubmission,betaGroups,preReleaseVersion"
  }));
  try {
    const app = (await api("GET", "/v1/apps/" + RELEASE.app)).data;
    assert(app?.id === RELEASE.app && app.attributes?.bundleId === RELEASE.bundle, "Wrong Apple app identity");
    // Verify membership using app-scoped endpoints. The independent live inspector
    // reads the app-scoped relationships successfully; this avoids expanding app data.
    const groups = (await api("GET", appGroupsPath, { limit: "200" })).data;
    const matches = groups.filter(x => x.id === RELEASE.group);
    assert(matches.length === 1, "Existing public group is not in the verified app");
    const group = matches[0];
    assert(group?.id === RELEASE.group && group.attributes?.name === RELEASE.groupName &&
      group.attributes?.isInternalGroup === false &&
      group.attributes?.publicLinkEnabled === true && group.attributes?.publicLink === RELEASE.publicLink,
      "Existing public group identity or link changed");
    const builds = (await api("GET", "/v1/builds", {
      "filter[app]": RELEASE.app, "filter[version]": RELEASE.build, limit: "200"
    })).data;
    assert(builds.length === 1 && builds[0].type === "builds" &&
      builds[0].id === RELEASE.appleBuild && builds[0].attributes?.version === RELEASE.build,
      "Wrong Apple build app membership");
    report.appScopedMembershipVerified = true;
    let state = await info();
    assert(state.internalBuildState === "IN_BETA_TESTING", "Internal testing prerequisite not met");
    assert(!["REJECTED", "EXPIRED", "BETA_REJECTED", "FAILED"].includes(state.betaReviewState) &&
      ["READY_FOR_BETA_SUBMISSION", "WAITING_FOR_BETA_REVIEW", "IN_BETA_REVIEW", "READY_FOR_BETA_TESTING", "IN_BETA_TESTING"].includes(state.externalBuildState),
      "External testing requires manual investigation");
    const locales = (await api("GET", buildPath + "/betaBuildLocalizations", { limit: "200" })).data;
    assert(locales.some(x => x.attributes?.locale === "en-US" &&
      typeof x.attributes?.whatsNew === "string" && x.attributes.whatsNew.trim().length > 0),
      "Existing beta release notes are missing");
    record("PRECHECK_PASSED", state);

    if (!state.groupAssigned) {
      await api("POST", buildPath + "/relationships/betaGroups", {}, {
        data: [{ type: "betaGroups", id: RELEASE.group }]
      });
      report.operations.push("assigned_existing_public_group");
      state = await info();
      assert(state.groupAssigned, "Public group assignment not confirmed");
      record("GROUP_ASSIGNED", state);
    }
    if (!state.autoNotifyEnabled && state.externalBuildState !== "IN_BETA_TESTING") {
      await api("PATCH", "/v1/buildBetaDetails/" + state.detailId, {}, {
        data: { type: "buildBetaDetails", id: state.detailId, attributes: { autoNotifyEnabled: true } }
      });
      report.operations.push("enabled_release_after_approval");
      state = await info();
      assert(state.autoNotifyEnabled, "Automatic release setting not confirmed");
      record("RELEASE_AFTER_APPROVAL_ENABLED", state);
    }
    if (state.externalBuildState === "READY_FOR_BETA_SUBMISSION" && !state.reviewId) {
      await api("POST", "/v1/betaAppReviewSubmissions", {}, {
        data: { type: "betaAppReviewSubmissions",
          relationships: { build: { data: { type: "builds", id: RELEASE.appleBuild } } } }
      });
      report.operations.push("submitted_beta_review");
      state = await info();
      record("BETA_REVIEW_SUBMITTED", state);
    }
    if (state.externalBuildState === "READY_FOR_BETA_TESTING") {
      await api("POST", "/v1/buildBetaNotifications", {}, {
        data: { type: "buildBetaNotifications",
          relationships: { build: { data: { type: "builds", id: RELEASE.appleBuild } } } }
      });
      report.operations.push("started_approved_external_testing");
      state = await info();
    }
    assert(state.groupAssigned, "Public group assignment not confirmed");
    record(state.externalBuildState === "IN_BETA_TESTING"
      ? "AVAILABLE_TO_PUBLIC_TESTERS"
      : state.reviewId && ["WAITING_FOR_REVIEW", "IN_REVIEW"].includes(state.betaReviewState)
        ? "APPLE_BETA_REVIEW_PENDING" : "APPLE_STATE_PROPAGATION_PENDING", state);
    return report;
  } catch (error) {
    record("BLOCKED");
    throw error;
  }
}

async function main() {
  try {
    const receipt = JSON.parse(readFileSync(process.env.UPLOAD_RECEIPT_PATH, "utf8"));
    const token = makeToken(JSON.parse(process.env.APP_STORE_CONNECT_API_KEY_CONTENT || ""));
    const report = await publish(apiClient(token), receipt, process.env.UPLOAD_RUN_ID,
      value => writeFileSync("redwallet-public-beta-verification.json", JSON.stringify(value, null, 2) + "\n", { mode: 0o600 }));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const safe = /^(Wrong |Invalid Apple |Unexpected Apple |Apple operation failed: HTTP |Incomplete Apple |Build is |Existing |Missing |Ambiguous |Internal testing |External testing |Public group |Automatic release )/;
    console.error(safe.test(error.message) ? error.message : "Public TestFlight release stopped; inspect its saved checkpoint");
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

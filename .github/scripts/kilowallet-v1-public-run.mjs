import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { makeToken } from "./inspect-ios-store.mjs";

export const APP = "6824331953";
export const BUNDLE = "com.kilombino.kilowallet";
export const VERSION = "1.0.0";
export const VERSION_ID = "1ca23695-4563-4a0e-b20e-d1a6457f4f8b";
export const SOURCE = "3f5beee29cfbbd257a5d967f6d2e505bfec4c1b3";
export const OLD_BUILD = "39bccc02-a2e3-4a30-a890-ddd0eb9273af";
export const BUILD = "7633bcb4-4902-4198-81d3-d9a64087a633";
export const BUILD_NUMBER = "30";
export const LOCALE_ID = "07229a9a-bc87-4458-a3f6-37c7a6a046df";
export const REVIEW_DETAIL_ID = "6446acd7-d950-4856-a412-0ba44fef5dfb";
export const APP_INFO_ID = "1b43fae1-2f76-4309-b4cb-58192371c956";
export const POLICY_LOCALE_ID = "d681427f-1723-4231-ac7f-b0ac69dff973";
export const POLICY_URL =
  "https://github.com/romanmodin/RedWallet/blob/main/distribution/kilowallet/RC7_PRIVACY.md";
export const GROUPS = [
  "8f0948f4-86ef-4f7a-aa47-830a6e8f4eae",
  "f4f2520c-3eaf-46f9-a31a-a36d38b74c53",
];
const ROOT = "https://api.appstoreconnect.apple.com";
const EDITABLE = new Set(["DEVELOPER_REJECTED", "PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW"]);
const SUBMITTED = new Set(["WAITING_FOR_REVIEW", "IN_REVIEW"]);
const TERMINAL_REVIEW = new Set(["COMPLETE"]);

const validId = (x) => typeof x === "string" && /^[A-Za-z0-9-]+$/.test(x);
const present = (x) => typeof x === "string" && x.trim().length > 0;
function cleanText(x, limit) {
  assert.equal(typeof x, "string");
  assert.ok(x.trim());
  assert.ok(x.length <= limit);
  return x;
}

export function validateCandidate(upload, beta) {
  assert.deepEqual(
    {
      app: upload.app,
      sourceCommit: upload.sourceCommit,
      build: upload.build,
      marketingVersion: upload.marketingVersion,
      appleBuildId: upload.appleBuildId,
      ipaSha256: upload.ipaSha256,
      artifactId: upload.artifactId,
      artifactSha256: upload.artifactSha256,
      runId: upload.runId,
      runAttempt: upload.runAttempt,
      signature: upload.signature,
      uploadVerified: upload.uploadVerified,
      currentNativeGatesVerified: upload.currentNativeGatesVerified,
      usesNonExemptEncryption: upload.usesNonExemptEncryption,
    },
    {
      app: APP,
      sourceCommit: SOURCE,
      build: BUILD_NUMBER,
      marketingVersion: VERSION,
      appleBuildId: BUILD,
      ipaSha256: "c9a14033af78ee52cb955ec9dfaf55694d999340035acd5f00480ef0859d47ad",
      artifactId: 14386469136,
      artifactSha256: "359452ec3d20301d59252e65048939d0aa8f37fb97331f086dab89e7931e138e",
      runId: 44199784070,
      runAttempt: 1,
      signature: "verified",
      uploadVerified: true,
      currentNativeGatesVerified: true,
      usesNonExemptEncryption: false,
    },
  );
  assert.equal(beta.action, "apply");
  assert.equal(beta.app, APP);
  assert.equal(beta.sourceCommit, SOURCE);
  assert.equal(beta.build, BUILD_NUMBER);
  assert.equal(beta.buildId, BUILD);
  assert.equal(beta.marketingVersion, VERSION);
  assert.equal(beta.ipaSha256, upload.ipaSha256);
  assert.equal(beta.uploadRunId, upload.runId);
  assert.equal(beta.uploadRunAttempt, 1);
  assert.equal(beta.coordinatorRun, "44275838101");
  assert.equal(beta.coordinatorAttempt, 1);
  assert.equal(beta.coordinatorCommit, "4423cf3b0842518e56af7e7c1ae95bba37f0406b");
  assert.equal(beta.complete, true);
  assert.equal(beta.available, true);
  assert.equal(beta.propagationPending, false);
  assert.equal(beta.status, "AVAILABLE_TO_TESTERS");
  assert.equal(beta.internalState, "IN_BETA_TESTING");
  assert.equal(beta.externalState, "IN_BETA_TESTING");
  assert.equal(beta.review?.buildId, BUILD);
  assert.equal(beta.review?.state, "APPROVED");
  assert.equal(beta.memberships?.length, 2);
  for (const id of GROUPS) {
    const membership = beta.memberships.find((x) => x.id === id);
    assert.deepEqual(membership, { id, buildSide: true, groupSide: true });
  }
  return structuredClone(upload);
}

export function validateRuntime(env) {
  assert.equal(env.GITHUB_REPOSITORY, "romanmodin/RedWallet");
  assert.equal(env.GITHUB_REF, "refs/heads/main");
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(
    env.GITHUB_WORKFLOW_REF,
    "romanmodin/RedWallet/.github/workflows/kilowallet-v1-public.yml@refs/heads/main",
  );
  assert.equal(env.GITHUB_RUN_ATTEMPT, "1");
  assert.match(env.GITHUB_SHA, /^[0-9a-f]{40}$/);
  assert.match(env.GITHUB_RUN_ID, /^[1-9][0-9]*$/);
  assert.equal(env.TEAM_ID, "PPG9C98EY9");
  assert.ok(["inspect", "withdraw", "submit"].includes(env.KILOWALLET_V1_PUBLIC_ACTION));
  return {
    action: env.KILOWALLET_V1_PUBLIC_ACTION,
    coordinatorCommit: env.GITHUB_SHA,
    coordinatorRun: env.GITHUB_RUN_ID,
    coordinatorAttempt: 1,
  };
}

export function durableJournal(event) {
  const fd = openSync("kilowallet-v1-public-journal.jsonl", "a", 0o600);
  try {
    writeSync(fd, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function client(token, candidate, journal, request = fetch) {
  validateCandidate(candidate.upload, candidate.beta);
  assert.ok(present(token) && !/[\r\n]/.test(token));
  assert.equal(typeof journal, "function");
  const attempted = new Set();

  function makeUrl(path, query) {
    const url = new URL(path, ROOT);
    assert.equal(url.origin, ROOT);
    assert.ok(!url.username && !url.password && !url.hash);
    url.search = new URLSearchParams(query || {});
    return url;
  }

  function fixedReads(path) {
    return new Set([
      "/v1/apps/" + APP,
      "/v1/builds/" + BUILD,
      "/v1/builds/" + BUILD + "/buildBetaDetail",
      "/v1/appStoreVersions/" + VERSION_ID,
      "/v1/appStoreVersions/" + VERSION_ID + "/build",
      "/v1/appStoreVersions/" + VERSION_ID + "/appStoreReviewDetail",
      "/v1/appStoreVersions/" + VERSION_ID + "/appStoreVersionLocalizations",
      "/v1/appStoreVersionLocalizations/" + LOCALE_ID + "/appScreenshotSets",
      "/v1/apps/" + APP + "/reviewSubmissions",
      "/v1/apps/" + APP + "/appInfos",
      "/v1/appInfos/" + APP_INFO_ID + "/appInfoLocalizations",
    ]).has(path);
  }

  function validateRead(url) {
    const path = url.pathname;
    const dynamic =
      /^\/v1\/reviewSubmissions\/[A-Za-z0-9-]+(?:\/items)?$/.test(path) ||
      /^\/v1\/appScreenshotSets\/[A-Za-z0-9-]+\/appScreenshots$/.test(path) ||
      /^\/v1\/betaAppReviewSubmissions\/[A-Za-z0-9-]+$/.test(path);
    assert.ok(fixedReads(path) || dynamic, "Foreign Apple read");
    for (const [key, value] of url.searchParams) {
      if (key === "limit") assert.equal(value, "200");
      else if (key === "include") {
        assert.ok([
          "app,preReleaseVersion,appEncryptionDeclaration,buildBetaDetail,betaAppReviewSubmission,betaGroups",
          "appStoreVersion",
          "build",
        ].includes(value));
      } else if (key === "fields[appStoreVersions]") {
        assert.equal(value, "versionString,platform");
      } else {
        throw new Error("Unexpected Apple query");
      }
    }
  }

  function validateWrite(method, path, body) {
    assert.ok(["PATCH", "POST"].includes(method), "Unexpected Apple write method");
    if (method === "PATCH" && path === "/v1/appStoreVersions/" + VERSION_ID + "/relationships/build") {
      assert.deepEqual(body, { data: { type: "builds", id: BUILD } });
      return "select-build";
    }
    if (method === "PATCH" && path === "/v1/appStoreReviewDetails/" + REVIEW_DETAIL_ID) {
      assert.equal(body?.data?.type, "appStoreReviewDetails");
      assert.equal(body?.data?.id, REVIEW_DETAIL_ID);
      assert.deepEqual(Object.keys(body.data.attributes || {}), ["notes"]);
      cleanText(body.data.attributes.notes, 4000);
      return "review-notes";
    }
    if (method === "PATCH" && path === "/v1/appStoreVersionLocalizations/" + LOCALE_ID) {
      assert.equal(body?.data?.type, "appStoreVersionLocalizations");
      assert.equal(body?.data?.id, LOCALE_ID);
      assert.deepEqual(Object.keys(body.data.attributes || {}), ["description"]);
      cleanText(body.data.attributes.description, 4000);
      return "description";
    }
    if (method === "PATCH" && path === "/v1/appInfoLocalizations/" + POLICY_LOCALE_ID) {
      assert.deepEqual(body, {
        data: {
          type: "appInfoLocalizations",
          id: POLICY_LOCALE_ID,
          attributes: { privacyPolicyUrl: POLICY_URL },
        },
      });
      return "privacy-policy";
    }
    if (method === "PATCH" && /^\/v1\/reviewSubmissions\/[A-Za-z0-9-]+$/.test(path)) {
      assert.equal(body?.data?.type, "reviewSubmissions");
      assert.equal(body?.data?.id, path.split("/").at(-1));
      const attrs = body?.data?.attributes || {};
      assert.ok(
        JSON.stringify(attrs) === JSON.stringify({ canceled: true }) ||
          JSON.stringify(attrs) === JSON.stringify({ submitted: true }),
      );
      return attrs.canceled ? "withdraw-review" : "submit-review";
    }
    if (method === "POST" && path === "/v1/reviewSubmissions") {
      assert.deepEqual(body, {
        data: {
          type: "reviewSubmissions",
          relationships: { app: { data: { type: "apps", id: APP } } },
        },
      });
      return "create-review";
    }
    if (method === "POST" && path === "/v1/reviewSubmissionItems") {
      assert.equal(body?.data?.type, "reviewSubmissionItems");
      assert.equal(body?.data?.relationships?.appStoreVersion?.data?.id, VERSION_ID);
      assert.equal(body?.data?.relationships?.reviewSubmission?.data?.type, "reviewSubmissions");
      assert.ok(validId(body?.data?.relationships?.reviewSubmission?.data?.id));
      return "create-review-item";
    }
    throw new Error("Foreign Apple write");
  }

  async function http(method, url, body) {
    const response = await request(url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error("Apple request failed: HTTP " + response.status);
    if (response.status === 204) return {};
    const result = await response.json();
    assert.ok(!result.links?.next, "Incomplete Apple response");
    return result;
  }

  async function api(method, path, body, query) {
    const url = makeUrl(path, query);
    if (method === "GET") {
      validateRead(url);
      return http(method, url);
    }
    assert.equal(url.search, "");
    const action = validateWrite(method, url.pathname, body);
    assert.ok(!attempted.has(action), "Write already attempted in this run");
    await journal({ stage: "public-write-started", action, method, path: url.pathname });
    attempted.add(action);
    const result = await http(method, url, structuredClone(body));
    await journal({
      stage: "public-write-returned",
      action,
      resourceType: result.data?.type,
      resourceId: result.data?.id,
    });
    return result;
  }
  return api;
}

async function collection(api, path, query = {}) {
  const result = await api("GET", path, undefined, { limit: "200", ...query });
  assert.ok(Array.isArray(result.data));
  assert.ok(!result.links?.next, "Incomplete paginated review snapshot");
  return result.data;
}

export async function readSnapshot(api) {
  const app = (await api("GET", "/v1/apps/" + APP)).data;
  assert.equal(app?.id, APP);
  assert.equal(app?.attributes?.bundleId, BUNDLE);

  const buildResult = await api("GET", "/v1/builds/" + BUILD, undefined, {
    include:
      "app,preReleaseVersion,appEncryptionDeclaration,buildBetaDetail,betaAppReviewSubmission,betaGroups",
  });
  const build = buildResult.data;
  assert.equal(build?.id, BUILD);
  assert.equal(build?.attributes?.version, BUILD_NUMBER);
  assert.equal(build?.attributes?.processingState, "VALID");
  assert.equal(build?.attributes?.expired, false);
  assert.equal(build?.attributes?.usesNonExemptEncryption, false);
  assert.equal(build?.relationships?.app?.data?.id, APP);
  assert.equal(build?.relationships?.appEncryptionDeclaration?.data ?? null, null);
  const groupIds = build?.relationships?.betaGroups?.data?.map((x) => x.id) || [];
  assert.deepEqual([...groupIds].sort(), [...GROUPS].sort());
  const groups = (buildResult.included || []).filter((x) => x.type === "betaGroups");
  assert.ok(GROUPS.every((id) => groups.some((x) => x.id === id)));
  const release = (buildResult.included || []).find((x) => x.type === "preReleaseVersions");
  assert.equal(release?.attributes?.version, VERSION);
  assert.equal(release?.attributes?.platform, "IOS");
  const reviewRef = build?.relationships?.betaAppReviewSubmission?.data;
  assert.equal(reviewRef?.type, "betaAppReviewSubmissions");
  assert.ok(validId(reviewRef?.id));
  const review = (
    await api(
      "GET",
      "/v1/betaAppReviewSubmissions/" + reviewRef.id,
      undefined,
      { include: "build" },
    )
  ).data;
  assert.equal(review?.attributes?.betaReviewState, "APPROVED");
  assert.equal(review?.relationships?.build?.data?.id, BUILD);
  const beta = (await api("GET", "/v1/builds/" + BUILD + "/buildBetaDetail")).data;
  assert.equal(beta?.attributes?.internalBuildState, "IN_BETA_TESTING");
  assert.equal(beta?.attributes?.externalBuildState, "IN_BETA_TESTING");

  const version = (await api("GET", "/v1/appStoreVersions/" + VERSION_ID)).data;
  assert.equal(version?.id, VERSION_ID);
  assert.equal(version?.attributes?.versionString, VERSION);
  assert.equal(version?.attributes?.platform, "IOS");
  assert.equal(version?.attributes?.releaseType, "AFTER_APPROVAL");
  const selected = (await api("GET", "/v1/appStoreVersions/" + VERSION_ID + "/build")).data;

  const reviewDetail = (
    await api("GET", "/v1/appStoreVersions/" + VERSION_ID + "/appStoreReviewDetail")
  ).data;
  assert.equal(reviewDetail?.id, REVIEW_DETAIL_ID);
  assert.equal(reviewDetail?.attributes?.demoAccountRequired, false);
  for (const key of ["contactFirstName", "contactLastName", "contactPhone", "contactEmail"]) {
    assert.ok(present(reviewDetail?.attributes?.[key]));
  }

  const locales = await collection(
    api,
    "/v1/appStoreVersions/" + VERSION_ID + "/appStoreVersionLocalizations",
  );
  const locale = locales.find((x) => x.id === LOCALE_ID);
  assert.equal(locale?.attributes?.locale, "en-US");
  assert.ok(present(locale?.attributes?.keywords));
  assert.equal(locale?.attributes?.supportUrl, "https://github.com/romanmodin/kilowallet-ios/issues");

  const sets = await collection(
    api,
    "/v1/appStoreVersionLocalizations/" + LOCALE_ID + "/appScreenshotSets",
  );
  assert.equal(sets.length, 2);
  for (const set of sets) {
    assert.ok(["APP_IPHONE_61", "APP_IPHONE_58"].includes(set.attributes?.screenshotDisplayType));
    const shots = await collection(api, "/v1/appScreenshotSets/" + set.id + "/appScreenshots");
    assert.equal(shots.length, 1);
    assert.equal(shots[0]?.attributes?.assetDeliveryState?.state, "COMPLETE");
  }

  const infos = await collection(api, "/v1/apps/" + APP + "/appInfos");
  assert.ok(infos.some((x) => x.id === APP_INFO_ID));
  const policyLocales = await collection(
    api,
    "/v1/appInfos/" + APP_INFO_ID + "/appInfoLocalizations",
  );
  const policy = policyLocales.find((x) => x.id === POLICY_LOCALE_ID);
  assert.equal(policy?.attributes?.locale, "en-US");

  const submissions = await collection(api, "/v1/apps/" + APP + "/reviewSubmissions");
  const active = submissions.filter((x) => !TERMINAL_REVIEW.has(x.attributes?.state));
  assert.ok(active.length <= 1, "Another review submission must be preserved");
  let activeReview = null;
  if (active.length) {
    const exact = (await api("GET", "/v1/reviewSubmissions/" + active[0].id)).data;
    assert.equal(exact?.id, active[0].id);
    assert.equal(exact?.attributes?.state, active[0].attributes?.state);
    const items = await collection(
      api,
      "/v1/reviewSubmissions/" + exact.id + "/items",
      { include: "appStoreVersion", "fields[appStoreVersions]": "versionString,platform" },
    );
    assert.ok(items.length <= 1);
    if (items.length)
      assert.equal(items[0]?.relationships?.appStoreVersion?.data?.id, VERSION_ID);
    activeReview = {
      id: exact.id,
      state: exact.attributes.state,
      itemId: items[0]?.id || null,
    };
  }

  return {
    versionState: version.attributes.appStoreState,
    selectedBuild: selected?.id || null,
    reviewNotes: reviewDetail.attributes.notes,
    description: locale.attributes.description,
    privacyPolicyUrl: policy.attributes.privacyPolicyUrl,
    activeReview,
    screenshotsComplete: true,
  };
}

export function planPublic(snapshot, action, metadata) {
  assert.ok(snapshot.screenshotsComplete);
  if (action === "inspect") return { status: "INSPECTED", writes: [] };
  if (
    snapshot.selectedBuild === BUILD &&
    SUBMITTED.has(snapshot.versionState) &&
    snapshot.activeReview &&
    snapshot.reviewNotes === metadata.notes &&
    snapshot.description === metadata.description &&
    snapshot.privacyPolicyUrl === POLICY_URL
  ) {
    return { status: "SUBMITTED_FOR_APP_REVIEW", writes: [] };
  }
  if (action === "withdraw") {
    if (!snapshot.activeReview && EDITABLE.has(snapshot.versionState)) {
      return { status: "WITHDRAWAL_COMPLETE", writes: [] };
    }
    assert.equal(snapshot.selectedBuild, OLD_BUILD);
    assert.ok(SUBMITTED.has(snapshot.versionState));
    assert.ok(snapshot.activeReview);
    assert.ok(SUBMITTED.has(snapshot.activeReview.state));
    assert.ok(validId(snapshot.activeReview.itemId), "Missing exact prior review item");
    return {
      status: "WITHDRAWAL_REQUIRED",
      writes: [{ action: "withdraw-review", reviewId: snapshot.activeReview.id }],
    };
  }
  assert.equal(action, "submit");
  if (snapshot.activeReview) {
    assert.equal(
      snapshot.activeReview.state,
      "READY_FOR_REVIEW",
      "Existing review must finish canceling",
    );
    assert.equal(snapshot.selectedBuild, BUILD);
    assert.equal(snapshot.reviewNotes, metadata.notes);
    assert.equal(snapshot.description, metadata.description);
    assert.equal(snapshot.privacyPolicyUrl, POLICY_URL);
    return {
      status: "SUBMISSION_RESUME",
      writes: [
        ...(snapshot.activeReview.itemId ? [] : [{ action: "create-review-item" }]),
        { action: "submit-review", reviewId: snapshot.activeReview.id },
      ],
    };
  }
  assert.ok(EDITABLE.has(snapshot.versionState), "Version is not editable");
  assert.ok([OLD_BUILD, BUILD].includes(snapshot.selectedBuild));
  const writes = [];
  if (snapshot.selectedBuild !== BUILD) writes.push({ action: "select-build" });
  if (snapshot.reviewNotes !== metadata.notes) writes.push({ action: "review-notes" });
  if (snapshot.description !== metadata.description) writes.push({ action: "description" });
  if (snapshot.privacyPolicyUrl !== POLICY_URL) writes.push({ action: "privacy-policy" });
  writes.push({ action: "create-review" }, { action: "create-review-item" }, { action: "submit-review" });
  return { status: "SUBMISSION_REQUIRED", writes };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withdraw(api, snapshot, metadata, journal, wait = delay) {
  const plan = planPublic(snapshot, "withdraw", metadata);
  if (!plan.writes.length) return { ...plan, snapshot };
  const fresh = await readSnapshot(api);
  const again = planPublic(fresh, "withdraw", metadata);
  assert.deepEqual(again.writes, plan.writes, "Review changed before withdrawal");
  const reviewId = fresh.activeReview.id;
  await api("PATCH", "/v1/reviewSubmissions/" + reviewId, {
    data: {
      type: "reviewSubmissions",
      id: reviewId,
      attributes: { canceled: true },
    },
  });
  let current = await readSnapshot(api);
  for (let i = 0; i < 18 && (!EDITABLE.has(current.versionState) || current.activeReview); i++) {
    await wait(10000);
    current = await readSnapshot(api);
  }
  const complete = EDITABLE.has(current.versionState) && !current.activeReview;
  await journal({ stage: "withdrawal-reconciled", complete, versionState: current.versionState });
  return {
    status: complete ? "WITHDRAWAL_COMPLETE" : "WAITING_FOR_REVIEW_CANCELLATION",
    writes: plan.writes,
    snapshot: current,
  };
}

async function submit(api, snapshot, metadata, journal, wait = delay) {
  const plan = planPublic(snapshot, "submit", metadata);
  if (!plan.writes.length) return { ...plan, snapshot };
  let current = await readSnapshot(api);
  assert.deepEqual(
    planPublic(current, "submit", metadata).writes,
    plan.writes,
    "Release changed before metadata update",
  );

  if (current.selectedBuild !== BUILD) {
    await api("PATCH", "/v1/appStoreVersions/" + VERSION_ID + "/relationships/build", {
      data: { type: "builds", id: BUILD },
    });
    const selected = (await api("GET", "/v1/appStoreVersions/" + VERSION_ID + "/build")).data;
    assert.equal(selected?.id, BUILD);
  }
  if (current.reviewNotes !== metadata.notes) {
    await api("PATCH", "/v1/appStoreReviewDetails/" + REVIEW_DETAIL_ID, {
      data: {
        type: "appStoreReviewDetails",
        id: REVIEW_DETAIL_ID,
        attributes: { notes: metadata.notes },
      },
    });
    const detail = (
      await api("GET", "/v1/appStoreVersions/" + VERSION_ID + "/appStoreReviewDetail")
    ).data;
    assert.equal(detail?.attributes?.notes, metadata.notes);
  }
  if (current.description !== metadata.description) {
    await api("PATCH", "/v1/appStoreVersionLocalizations/" + LOCALE_ID, {
      data: {
        type: "appStoreVersionLocalizations",
        id: LOCALE_ID,
        attributes: { description: metadata.description },
      },
    });
    const locales = await collection(
      api,
      "/v1/appStoreVersions/" + VERSION_ID + "/appStoreVersionLocalizations",
    );
    assert.equal(
      locales.find((x) => x.id === LOCALE_ID)?.attributes?.description,
      metadata.description,
    );
  }
  if (current.privacyPolicyUrl !== POLICY_URL) {
    await api("PATCH", "/v1/appInfoLocalizations/" + POLICY_LOCALE_ID, {
      data: {
        type: "appInfoLocalizations",
        id: POLICY_LOCALE_ID,
        attributes: { privacyPolicyUrl: POLICY_URL },
      },
    });
    const locales = await collection(
      api,
      "/v1/appInfos/" + APP_INFO_ID + "/appInfoLocalizations",
    );
    assert.equal(
      locales.find((x) => x.id === POLICY_LOCALE_ID)?.attributes?.privacyPolicyUrl,
      POLICY_URL,
    );
  }

  current = await readSnapshot(api);
  assert.equal(current.selectedBuild, BUILD);
  assert.equal(current.reviewNotes, metadata.notes);
  assert.equal(current.description, metadata.description);
  assert.equal(current.privacyPolicyUrl, POLICY_URL);

  let reviewId, hasItem;
  if (current.activeReview) {
    assert.equal(current.activeReview.state, "READY_FOR_REVIEW");
    assert.ok(validId(current.activeReview.id));
    reviewId = current.activeReview.id;
    hasItem = Boolean(current.activeReview.itemId);
  } else {
    assert.ok(EDITABLE.has(current.versionState));
    const review = (
      await api("POST", "/v1/reviewSubmissions", {
        data: {
          type: "reviewSubmissions",
          relationships: { app: { data: { type: "apps", id: APP } } },
        },
      })
    ).data;
    assert.ok(validId(review?.id));
    assert.equal(review?.attributes?.state, "READY_FOR_REVIEW");
    reviewId = review.id;
    hasItem = false;
  }
  if (!hasItem)
    await api("POST", "/v1/reviewSubmissionItems", {
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: { data: { type: "reviewSubmissions", id: reviewId } },
          appStoreVersion: { data: { type: "appStoreVersions", id: VERSION_ID } },
        },
      },
    });
  const items = await collection(
    api,
    "/v1/reviewSubmissions/" + reviewId + "/items",
    { include: "appStoreVersion", "fields[appStoreVersions]": "versionString,platform" },
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]?.relationships?.appStoreVersion?.data?.id, VERSION_ID);

  const beforeSubmit = await readSnapshot(api);
  assert.equal(beforeSubmit.activeReview?.id, reviewId);
  assert.equal(beforeSubmit.activeReview?.state, "READY_FOR_REVIEW");
  assert.equal(beforeSubmit.selectedBuild, BUILD);
  assert.equal(beforeSubmit.reviewNotes, metadata.notes);
  assert.equal(beforeSubmit.description, metadata.description);
  assert.equal(beforeSubmit.privacyPolicyUrl, POLICY_URL);

  await api("PATCH", "/v1/reviewSubmissions/" + reviewId, {
    data: {
      type: "reviewSubmissions",
      id: reviewId,
      attributes: { submitted: true },
    },
  });
  let final = await readSnapshot(api);
  for (let i = 0; i < 12 && !SUBMITTED.has(final.versionState); i++) {
    await wait(10000);
    final = await readSnapshot(api);
  }
  assert.equal(final.selectedBuild, BUILD);
  assert.equal(final.activeReview?.id, reviewId);
  assert.ok(SUBMITTED.has(final.activeReview?.state));
  assert.ok(SUBMITTED.has(final.versionState));
  assert.equal(final.reviewNotes, metadata.notes);
  assert.equal(final.description, metadata.description);
  assert.equal(final.privacyPolicyUrl, POLICY_URL);
  await journal({ stage: "submission-reconciled", reviewId, versionState: final.versionState });
  return {
    status: "SUBMITTED_FOR_APP_REVIEW",
    writes: plan.writes,
    reviewId,
    snapshot: final,
  };
}

export async function execute(env, upload, beta, metadata, dependencies = {}) {
  const candidate = validateCandidate(upload, beta);
  const context = validateRuntime(env);
  metadata = {
    notes: cleanText(metadata.notes, 4000),
    description: cleanText(metadata.description, 4000),
  };
  assert.ok(metadata.notes.includes(SOURCE));
  assert.ok(metadata.notes.includes("build 30"));
  assert.ok(metadata.notes.includes("synthetic"));
  assert.ok(metadata.description.includes("PAY THROUGH JOINBLAKET"));
  const journal = dependencies.journal || durableJournal;
  let credential;
  try {
    credential = JSON.parse(env.APP_STORE_CONNECT_API_KEY_CONTENT || "");
  } catch {
    throw new Error("Apple API credential format is invalid");
  } finally {
    delete env.APP_STORE_CONNECT_API_KEY_CONTENT;
  }
  const token = (dependencies.tokenFactory || makeToken)(credential);
  credential = null;
  const api = (dependencies.clientFactory || client)(
    token,
    { upload: candidate, beta },
    journal,
    dependencies.request || fetch,
  );
  const snapshot = await readSnapshot(api);
  const outcome =
    context.action === "withdraw"
      ? await withdraw(api, snapshot, metadata, journal, dependencies.wait)
      : context.action === "submit"
        ? await submit(api, snapshot, metadata, journal, dependencies.wait)
        : { ...planPublic(snapshot, "inspect", metadata), snapshot };
  return {
    app: APP,
    version: VERSION,
    build: BUILD_NUMBER,
    buildId: BUILD,
    sourceCommit: SOURCE,
    ipaSha256: candidate.ipaSha256,
    ...context,
    ...outcome,
    complete: true,
    readOnly: context.action === "inspect",
    observedAt: new Date().toISOString(),
  };
}

async function main() {
  let result = { app: APP, version: VERSION, build: BUILD_NUMBER, complete: false };
  try {
    const upload = JSON.parse(readFileSync("kilowallet-upload-qualification.json", "utf8"));
    const beta = JSON.parse(readFileSync("kilowallet-v1-beta-result.json", "utf8"));
    const metadata = {
      notes: readFileSync("distribution/kilowallet/RC7_APP_REVIEW_NOTES.txt", "utf8").trim(),
      description: readFileSync(
        "distribution/kilowallet/RC7_APP_STORE_DESCRIPTION.txt",
        "utf8",
      ).trim(),
    };
    result = await execute(process.env, upload, beta, metadata);
    process.stdout.write(
      JSON.stringify({
        app: result.app,
        build: result.build,
        action: result.action,
        status: result.status,
        complete: result.complete,
        readOnly: result.readOnly,
      }) + "\n",
    );
  } catch (error) {
    result.status = "STOPPED_FOR_RECONCILIATION";
    result.failure = {
      kind: error?.code === "ERR_ASSERTION" ? "AssertionError" : "ReadOrRuntimeError",
      httpStatus: /^Apple request failed: HTTP (\d{3})$/.exec(error?.message || "")?.[1] || null,
      sourceFrames: String(error?.stack || "")
        .split("\n")
        .filter((line) => /^\s+at .*kilowallet-v1-public-run\.mjs:\d+:\d+/.test(line))
        .slice(0, 4),
    };
    result.error =
      "Exact qualification, protected runtime, or Apple reconciliation failed; inspect the journal before another run.";
    process.stderr.write(result.error + "\n");
    process.exitCode = 1;
  } finally {
    delete process.env.APP_STORE_CONNECT_API_KEY_CONTENT;
    writeFileSync(
      "kilowallet-v1-public-result.json",
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600 },
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

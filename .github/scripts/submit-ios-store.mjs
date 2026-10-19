import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { makeToken, APP_ID, BUNDLE_ID, VERSION } from "./inspect-ios-store.mjs";
export const SOURCE = "9f627fb87b4b6cc28cddcf6ad45e2edc721551a8";
const VERSION_ID = "65cd6bc4-9962-4b77-a3ca-78c115f3a615";
const LOCALE_ID = "67c79fa3-be47-4fc0-94c5-713836f9d262";
const POLICY =
  "https://github.com/romanmodin/RedWallet/blob/" + SOURCE + "/docs/PRIVACY.md";
class SubmissionError extends Error {}
function check(ok, message) {
  if (!ok) throw new SubmissionError(message);
}
function id(x) {
  check(
    typeof x === "string" && /^[A-Za-z0-9-]+$/.test(x),
    "Invalid Apple identity",
  );
  return x;
}
const present = (x) => typeof x === "string" && x.trim().length > 0;
export function verifyReceipts(ipa, beta, mainShots, messageShots) {
  check(
    ipa.sourceCommit === SOURCE &&
      ipa.publicSourceCommit === SOURCE &&
      ipa.orchestrationCommit === "2e48763dfe0b1dd90763c47323143af527bd8148" &&
      ipa.ipaSha256 ===
        "1f35c12670d95c54dd7f960b9b9b7d09b12fda8ff7d7ca64e3003998f8784dd0" &&
      ipa.signatureVerification === "passed" &&
      ipa.sourceMappingVerification === "passed",
    "Unqualified signed package",
  );
  check(
    beta.sourceCommit === SOURCE &&
      beta.uploadRunId === "39312792179" &&
      beta.ipaSha256 === ipa.ipaSha256 &&
      beta.processingState === "VALID",
    "Unverified Apple build",
  );
  check(
    beta.appId === APP_ID &&
      beta.bundleId === BUNDLE_ID &&
      beta.version === VERSION &&
      id(beta.appleBuildId) &&
      beta.build === "1792439689",
    "Wrong release identity",
  );
  check(
    ipa.bundles.length === 2 &&
      ipa.bundles.every(
        (b) => b.version === VERSION && b.build === beta.build,
      ) &&
      new Set(ipa.bundles.map((b) => b.bundleId)).size === 2 &&
      ipa.bundles.some((b) => b.bundleId === BUNDLE_ID) &&
      ipa.bundles.some((b) => b.bundleId === BUNDLE_ID + ".Stickers"),
    "Wrong signed bundles",
  );
  check(
    mainShots.appId === APP_ID &&
      mainShots.version === VERSION &&
      mainShots.appStoreVersionId === VERSION_ID &&
      mainShots.status === "SCREENSHOTS_REPLACED" &&
      mainShots.sourceCommit === SOURCE &&
      mainShots.captureRunId === 39312798717 &&
      mainShots.images.length === 8 &&
      mainShots.images.every((i) => i.state === "COMPLETE"),
    "Main screenshots not verified",
  );
  check(
    messageShots.appId === APP_ID &&
      messageShots.version === VERSION &&
      messageShots.appStoreVersionId === VERSION_ID &&
      messageShots.sourceCommit === SOURCE &&
      messageShots.captureRunId === 39319942381 &&
      messageShots.status === "SCREENSHOTS_COMPLETE" &&
      messageShots.images.length === 2 &&
      messageShots.images.every((i) => i.state === "COMPLETE"),
    "iMessage screenshots not verified",
  );
  const images = [...mainShots.images, ...messageShots.images];
  check(
    new Set(images.map((i) => id(i.id))).size === 10,
    "Duplicate screenshot identities",
  );
  for (const family of ["iphone", "ipad"]) {
    check(
      mainShots.images.filter((i) => i.family === family).length === 4 &&
        messageShots.images.filter((i) => i.family === family).length === 1,
      "Wrong screenshot family",
    );
  }
  return {
    build: beta.build,
    appleBuildId: beta.appleBuildId,
    ipaSha256: ipa.ipaSha256,
    images,
  };
}
export function client(token, request = fetch) {
  return async (method, path, payload, query = {}) => {
    const get =
      /^\/v1\/(?:apps\/6817118871(?:\/(?:appInfos|reviewSubmissions))?|appInfos\/[A-Za-z0-9-]+\/appInfoLocalizations|appStoreVersions\/65cd6bc4-9962-4b77-a3ca-78c115f3a615(?:\/(?:build|appStoreReviewDetail|appStoreVersionLocalizations))?|appStoreVersionLocalizations\/67c79fa3-be47-4fc0-94c5-713836f9d262\/appScreenshotSets|appScreenshotSets\/[A-Za-z0-9-]+\/appScreenshots|builds\/[A-Za-z0-9-]+(?:\/(?:app|preReleaseVersion))?|reviewSubmissions\/[A-Za-z0-9-]+(?:\/items)?)$/;
    const patch =
      /^\/v1\/(?:appStoreVersions\/65cd6bc4-9962-4b77-a3ca-78c115f3a615\/relationships\/build|appInfoLocalizations\/[A-Za-z0-9-]+|reviewSubmissions\/[A-Za-z0-9-]+)$/;
    check(
      (method === "GET" && get.test(path)) ||
        (method === "PATCH" && patch.test(path)) ||
        (method === "POST" &&
          ["/v1/reviewSubmissions", "/v1/reviewSubmissionItems"].includes(
            path,
          )),
      "Unexpected Apple operation",
    );
    const url = new URL(path, "https://api.appstoreconnect.apple.com");
    url.search = new URLSearchParams(query);
    const response = await request(url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    if (!response.ok) {
      let codes = [];
      try {
        codes =
          (await response.json()).errors?.map((e) =>
            String(e.code || "")
              .replace(/[^A-Za-z0-9_.-]/g, "")
              .slice(0, 160),
          ) || [];
      } catch {}
      throw new SubmissionError(
        "Apple " +
          method +
          " " +
          path +
          " failed HTTP " +
          response.status +
          " codes " +
          codes.join(","),
      );
    }
    if (response.status === 204) return {};
    const result = await response.json();
    check(!result.links?.next, "Incomplete Apple response");
    return result;
  };
}
export async function verifyListing(api, candidate) {
  const app = (await api("GET", "/v1/apps/" + APP_ID)).data;
  check(
    app?.id === APP_ID && app.attributes?.bundleId === BUNDLE_ID,
    "Wrong Apple app",
  );
  const version = (await api("GET", "/v1/appStoreVersions/" + VERSION_ID)).data;
  check(
    version?.id === VERSION_ID &&
      version.attributes?.versionString === VERSION &&
      version.attributes.platform === "IOS" &&
      version.attributes.releaseType === "AFTER_APPROVAL",
    "Unexpected App Store version or release mode",
  );
  const build = (await api("GET", "/v1/builds/" + id(candidate.appleBuildId)))
    .data;
  check(
    build?.attributes?.version === candidate.build &&
      build.attributes.processingState === "VALID" &&
      build.attributes.expired === false &&
      build.attributes.usesNonExemptEncryption === false,
    "Apple build is not ready",
  );
  const buildApp = (
    await api("GET", "/v1/builds/" + candidate.appleBuildId + "/app")
  ).data;
  const release = (
    await api(
      "GET",
      "/v1/builds/" + candidate.appleBuildId + "/preReleaseVersion",
    )
  ).data;
  check(
    buildApp?.id === APP_ID &&
      release?.attributes?.version === VERSION &&
      release.attributes.platform === "IOS",
    "Apple build belongs to another release",
  );
  const review = (
    await api(
      "GET",
      "/v1/appStoreVersions/" + VERSION_ID + "/appStoreReviewDetail",
    )
  ).data?.attributes;
  check(
    review &&
      [
        "contactFirstName",
        "contactLastName",
        "contactPhone",
        "contactEmail",
        "notes",
      ].every((k) => present(review[k])) &&
      review.demoAccountRequired === false,
    "Existing review information incomplete",
  );
  const locales = (
    await api(
      "GET",
      "/v1/appStoreVersions/" + VERSION_ID + "/appStoreVersionLocalizations",
      undefined,
      { limit: "200" },
    )
  ).data;
  const locale = locales.find(
    (l) => l.id === LOCALE_ID && l.attributes?.locale === "en-US",
  );
  check(
    locale &&
      ["description", "keywords", "supportUrl"].every((k) =>
        present(locale.attributes[k]),
      ),
    "Existing store localization incomplete",
  );
  const sets = (
    await api(
      "GET",
      "/v1/appStoreVersionLocalizations/" + LOCALE_ID + "/appScreenshotSets",
      undefined,
      { limit: "200" },
    )
  ).data;
  const expectedTypes = {
    APP_IPHONE_67: 4,
    APP_IPAD_PRO_3GEN_129: 4,
    IMESSAGE_APP_IPHONE_67: 1,
    IMESSAGE_APP_IPAD_PRO_3GEN_129: 1,
  };
  const all = [];
  for (const [type, count] of Object.entries(expectedTypes)) {
    const found = sets.filter(
      (s) => s.attributes?.screenshotDisplayType === type,
    );
    check(found.length === 1, "Missing required screenshot family");
    const shots = (
      await api(
        "GET",
        "/v1/appScreenshotSets/" + id(found[0].id) + "/appScreenshots",
        undefined,
        { limit: "200" },
      )
    ).data;
    check(
      shots.length === count &&
        shots.every(
          (s) =>
            s.attributes?.assetDeliveryState?.state === "COMPLETE" &&
            candidate.images.some((i) => i.id === s.id),
        ),
      "Apple screenshots differ from reviewed uploads",
    );
    all.push(...shots);
  }
  check(
    all.length === candidate.images.length,
    "Screenshot receipt count mismatch",
  );
  return version;
}
export async function submit(api, candidate, report) {
  const version = await verifyListing(api, candidate);
  check(
    [
      "PREPARE_FOR_SUBMISSION",
      "READY_FOR_REVIEW",
      "WAITING_FOR_REVIEW",
      "IN_REVIEW",
    ].includes(version.attributes.appStoreState),
    "Version state requires review",
  );
  let selected = (
    await api("GET", "/v1/appStoreVersions/" + VERSION_ID + "/build")
  ).data;
  const already = ["WAITING_FOR_REVIEW", "IN_REVIEW"].includes(
    version.attributes.appStoreState,
  );
  if (already)
    check(
      selected?.id === candidate.appleBuildId,
      "Submitted version has another build",
    );
  else {
    check(
      !selected ||
        [
          candidate.appleBuildId,
          "0c79c478-9b0f-4017-a62f-499e8d5e7143",
        ].includes(selected.id),
      "Unexpected selected build; preserve it for review",
    );
    if (selected?.id !== candidate.appleBuildId)
      await api(
        "PATCH",
        "/v1/appStoreVersions/" + VERSION_ID + "/relationships/build",
        { data: { type: "builds", id: candidate.appleBuildId } },
      );
    selected = (
      await api("GET", "/v1/appStoreVersions/" + VERSION_ID + "/build")
    ).data;
    check(
      selected?.id === candidate.appleBuildId,
      "Build selection was not confirmed",
    );
  }
  report.selectedBuild = candidate.appleBuildId;
  const infos = (
    await api("GET", "/v1/apps/" + APP_ID + "/appInfos", undefined, {
      limit: "200",
    })
  ).data;
  const editable = infos.filter(
    (i) => i.attributes?.appStoreState === version.attributes.appStoreState,
  );
  check(editable.length === 1, "Ambiguous app information");
  const infoLocales = (
    await api(
      "GET",
      "/v1/appInfos/" + id(editable[0].id) + "/appInfoLocalizations",
      undefined,
      { limit: "200" },
    )
  ).data;
  const en = infoLocales.filter((l) => l.attributes?.locale === "en-US");
  check(en.length === 1, "Ambiguous privacy localization");
  if (en[0].attributes.privacyPolicyUrl !== POLICY) {
    check(!already, "Submitted privacy policy differs; do not mutate");
    check(
      typeof en[0].attributes.privacyPolicyUrl === "string" &&
        en[0].attributes.privacyPolicyUrl.includes("romanmodin/RedWallet") &&
        en[0].attributes.privacyPolicyUrl.endsWith("/docs/PRIVACY.md"),
      "Unexpected existing privacy policy",
    );
    await api("PATCH", "/v1/appInfoLocalizations/" + id(en[0].id), {
      data: {
        type: "appInfoLocalizations",
        id: en[0].id,
        attributes: { privacyPolicyUrl: POLICY },
      },
    });
  }
  const confirmed = (
    await api(
      "GET",
      "/v1/appInfos/" + id(editable[0].id) + "/appInfoLocalizations",
      undefined,
      { limit: "200" },
    )
  ).data;
  check(
    confirmed.some(
      (l) => l.id === en[0].id && l.attributes?.privacyPolicyUrl === POLICY,
    ),
    "Privacy policy update was not confirmed",
  );
  report.privacyPolicy = POLICY;
  const submissions = (
    await api("GET", "/v1/apps/" + APP_ID + "/reviewSubmissions", undefined, {
      limit: "200",
    })
  ).data;
  const active = submissions.filter(
    (s) => !["COMPLETE", "CANCELED"].includes(s.attributes?.state),
  );
  check(active.length <= 1, "Multiple active review submissions");
  let review = active[0];
  if (!review) {
    check(!already, "Submitted version lacks review receipt");
    review = (
      await api("POST", "/v1/reviewSubmissions", {
        data: {
          type: "reviewSubmissions",
          relationships: { app: { data: { type: "apps", id: APP_ID } } },
        },
      })
    ).data;
  }
  const reviewId = id(review.id);
  report.reviewSubmissionId = reviewId;
  let items = (
    await api(
      "GET",
      "/v1/reviewSubmissions/" + reviewId + "/items",
      undefined,
      {
        limit: "200",
        include: "appStoreVersion",
        "fields[appStoreVersions]": "versionString,platform",
      },
    )
  ).data;
  check(
    items.length <= 1 &&
      items.every(
        (i) => i.relationships?.appStoreVersion?.data?.id === VERSION_ID,
      ),
    "Existing submission includes another item",
  );
  if (!items.length) {
    check(
      review.attributes?.state === "READY_FOR_REVIEW" && !already,
      "Review draft is not editable",
    );
    await api("POST", "/v1/reviewSubmissionItems", {
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: {
            data: { type: "reviewSubmissions", id: reviewId },
          },
          appStoreVersion: {
            data: { type: "appStoreVersions", id: VERSION_ID },
          },
        },
      },
    });
  }
  items = (
    await api(
      "GET",
      "/v1/reviewSubmissions/" + reviewId + "/items",
      undefined,
      {
        limit: "200",
        include: "appStoreVersion",
        "fields[appStoreVersions]": "versionString,platform",
      },
    )
  ).data;
  check(
    items.length === 1 &&
      items[0].relationships?.appStoreVersion?.data?.id === VERSION_ID,
    "Review item was not confirmed",
  );
  // Last live check after metadata changes and immediately before submission.
  await verifyListing(api, candidate);
  check(
    (await api("GET", "/v1/appStoreVersions/" + VERSION_ID + "/build")).data
      ?.id === candidate.appleBuildId,
    "Selected build changed",
  );
  review = (await api("GET", "/v1/reviewSubmissions/" + reviewId)).data;
  if (review.attributes?.state === "READY_FOR_REVIEW")
    await api("PATCH", "/v1/reviewSubmissions/" + reviewId, {
      data: {
        type: "reviewSubmissions",
        id: reviewId,
        attributes: { submitted: true },
      },
    });
  const verified = (await api("GET", "/v1/reviewSubmissions/" + reviewId)).data;
  report.reviewState = verified.attributes?.state;
  report.appStoreState = (
    await api("GET", "/v1/appStoreVersions/" + VERSION_ID)
  ).data?.attributes?.appStoreState;
  check(
    ["WAITING_FOR_REVIEW", "IN_REVIEW"].includes(report.reviewState),
    "Submission state still requires review",
  );
  report.status = "SUBMITTED_FOR_APP_REVIEW";
  report.submitted = true;
  return report;
}
async function main() {
  const report = {
    appId: APP_ID,
    version: VERSION,
    sourceCommit: SOURCE,
    submitted: false,
    checkedAt: new Date().toISOString(),
  };
  try {
    const read = (p) => JSON.parse(readFileSync(p, "utf8"));
    const candidate = verifyReceipts(
      read("submission-receipts/ios-ipa-verification.json"),
      read("submission-receipts/testflight-beta-verification.json"),
      read("submission-receipts/store-screenshot-receipt.json"),
      read("submission-receipts/imessage-upload-receipt.json"),
    );
    report.build = candidate.build;
    report.ipaSha256 = candidate.ipaSha256;
    await submit(
      client(
        makeToken(
          JSON.parse(process.env.APP_STORE_CONNECT_API_KEY_CONTENT || ""),
        ),
      ),
      candidate,
      report,
    );
  } catch (error) {
    report.status = "STOPPED_FOR_REVIEW";
    report.error =
      error instanceof SubmissionError
        ? error.message
        : "Unexpected submission failure; raw diagnostics omitted";
    process.exitCode = 1;
  } finally {
    writeFileSync(
      "app-review-submission.json",
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600 },
    );
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { makeToken } from "./inspect-ios-store.mjs";
import { client, verifyListing } from "./submit-ios-store.mjs";
import {
  REPLACEMENT_SOURCE,
  OLD_REVIEW,
  withdrawSupersededReview,
} from "./replace-ios-review.mjs";
const PRIOR_SOURCE = "9f627fb87b4b6cc28cddcf6ad45e2edc721551a8";
const APP = "6817118871";
const VERSION = "65cd6bc4-9962-4b77-a3ca-78c115f3a615";
const GROUPS = [
  "0bc2722a-48b6-4520-871d-dd5a4a8988cb",
  "463ff340-3283-4f17-949d-39c7aa929da2",
];
function check(ok, message) {
  if (!ok) throw Error(message);
}
export function withdrawalCandidate(
  ipa,
  beta,
  mainShots,
  messageShots,
  capture,
  reuse,
) {
  check(
    ipa.sourceCommit === REPLACEMENT_SOURCE &&
      ipa.publicSourceCommit === REPLACEMENT_SOURCE &&
      ipa.orchestrationCommit === "b881585e528a9d06b20f67b28a774bd540f3fd20" &&
      ipa.ipaSha256 ===
        "4d0dc7e91c2acd01eac6d9efe07c574724c28c1483c663e013a8259d2bf5e77e" &&
      ipa.signatureVerification === "passed" &&
      ipa.sourceMappingVerification === "passed",
    "Unverified replacement package",
  );
  check(
    beta.sourceCommit === REPLACEMENT_SOURCE &&
      beta.uploadRunId === "39799087741" &&
      beta.ipaSha256 === ipa.ipaSha256 &&
      beta.appId === APP &&
      beta.version === "8.0.1" &&
      beta.build === "1792686194" &&
      /^[A-Za-z0-9-]+$/.test(beta.appleBuildId || "") &&
      beta.processingState === "VALID" &&
      beta.status === "AVAILABLE_TO_TESTERS" &&
      beta.internalBuildState === "IN_BETA_TESTING" &&
      beta.externalBuildState === "IN_BETA_TESTING" &&
      GROUPS.every((g) =>
        beta.groups?.some((x) => x.id === g && x.assigned === true),
      ),
    "Replacement tester delivery not verified",
  );
  check(
    ipa.bundles?.length === 2 &&
      ["com.romanmodin.redwallet", "com.romanmodin.redwallet.Stickers"].every(
        (id) =>
          ipa.bundles.some(
            (b) =>
              b.bundleId === id &&
              b.version === "8.0.1" &&
              b.build === beta.build &&
              b.architectures?.join() === "arm64",
          ),
      ),
    "Wrong signed bundles",
  );
  check(
    capture.sourceCommit === REPLACEMENT_SOURCE &&
      capture.captureRunId === 39799093428 &&
      capture.captureAttempt === 1 &&
      capture.visuallyReviewed === true &&
      capture.images?.length === 8,
    "Fresh reviewed capture missing",
  );
  check(
    reuse.replacementSourceCommit === REPLACEMENT_SOURCE &&
      reuse.previousSourceCommit === PRIOR_SOURCE &&
      reuse.previousIosTree === "30e39cdee442e7d716cdc95de44ada6df2a523b7" &&
      reuse.replacementIosTree === reuse.previousIosTree &&
      reuse.newPackageVerificationPending === false,
    "Unchanged sticker source not verified",
  );
  check(
    mainShots.sourceCommit === PRIOR_SOURCE &&
      mainShots.captureRunId === 39312798717 &&
      mainShots.status === "SCREENSHOTS_REPLACED" &&
      mainShots.images?.length === 8,
    "Prior main assets not verified",
  );
  check(
    messageShots.sourceCommit === PRIOR_SOURCE &&
      messageShots.captureRunId === 39319942381 &&
      messageShots.status === "SCREENSHOTS_COMPLETE" &&
      messageShots.images?.length === 2,
    "Prior sticker assets not verified",
  );
  for (const receipt of [mainShots, messageShots])
    check(
      receipt.appId === APP &&
        receipt.version === "8.0.1" &&
        receipt.appStoreVersionId === VERSION &&
        receipt.images.every((i) => i.state === "COMPLETE"),
      "Wrong existing asset receipt",
    );
  const images = [...mainShots.images, ...messageShots.images];
  check(
    new Set(images.map((i) => i.id)).size === 10,
    "Duplicate existing asset identity",
  );
  return {
    sourceCommit: REPLACEMENT_SOURCE,
    build: beta.build,
    appleBuildId: beta.appleBuildId,
    ipaSha256: ipa.ipaSha256,
    images,
  };
}
export function withdrawalClient(token, request = fetch) {
  const api = client(token, request);
  return async (method, path, payload, query) => {
    check(
      method === "GET" ||
        (method === "PATCH" &&
          path === "/v1/reviewSubmissions/" + OLD_REVIEW &&
          JSON.stringify(payload) ===
            JSON.stringify({
              data: {
                type: "reviewSubmissions",
                id: OLD_REVIEW,
                attributes: { canceled: true },
              },
            })),
      "Withdrawal cannot select, submit, or change another resource",
    );
    return api(method, path, payload, query);
  };
}
async function main() {
  const report = {
    sourceCommit: REPLACEMENT_SOURCE,
    submitted: false,
    checkedAt: new Date().toISOString(),
  };
  try {
    const read = (p) => JSON.parse(readFileSync(p, "utf8"));
    const candidate = withdrawalCandidate(
      ...[
        "ios-ipa-verification.json",
        "testflight-beta-verification.json",
        "store-screenshot-receipt.json",
        "imessage-upload-receipt.json",
      ].map((p) => read("submission-receipts/" + p)),
      read(".github/release/IOS-STORE-SCREENSHOTS-20261019.json"),
      read(".github/release/IOS-V4-IMESSAGE-REUSE-20261022.json"),
    );
    report.build = candidate.build;
    report.appleBuildId = candidate.appleBuildId;
    const api = withdrawalClient(
      makeToken(
        JSON.parse(process.env.APP_STORE_CONNECT_API_KEY_CONTENT || ""),
      ),
    );
    await verifyListing(api, candidate);
    await withdrawSupersededReview(api, candidate, report);
    report.status = report.replacementStatus;
  } catch (error) {
    report.status = "STOPPED_FOR_REVIEW";
    report.error =
      "Withdrawal stopped; inspect the retained state before another attempt";
    process.exitCode = 1;
  } finally {
    writeFileSync(
      "app-review-withdrawal.json",
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600 },
    );
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();

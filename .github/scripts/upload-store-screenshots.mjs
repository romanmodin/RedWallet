import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { makeToken, APP_ID, VERSION } from "./inspect-ios-store.mjs";
import { client, upload, verifyImage } from "./upload-imessage-screenshots.mjs";

const VERSION_ID = "65cd6bc4-9962-4b77-a3ca-78c115f3a615";
const LOCALE_ID = "67c79fa3-be47-4fc0-94c5-713836f9d262";
export const OLD = {
  APP_IPHONE_67: [
    "e1800019-654f-8a97-802d-6d7bd53b2728",
    "24800019-654f-8a97-8020-82197d778f39",
    "b1c00019-654f-8a97-801a-98c963a082f2",
    "6e800019-654f-8a97-8023-57516b0a0d02",
  ],
  APP_IPAD_PRO_3GEN_129: [
    "39800019-654f-8a97-803a-a4f3b667e519",
    "3f800019-654f-8a97-8002-8725f2531b43",
    "04800019-654f-8a97-801b-2cd085a0d164",
    "83c00019-654f-8a97-8021-61ddbf92f8d9",
  ],
};

function check(ok, message) {
  if (!ok) throw Error(message);
}
const oldIds = Object.values(OLD).flat();
export function storeClient(token, request = fetch) {
  const normal = client(token, request);
  return async (method, path, payload) => {
    if (method !== "DELETE") return normal(method, path, payload);
    check(
      oldIds.some((id) => path === "/v1/appScreenshots/" + id),
      "Unexpected screenshot deletion",
    );
    const r = await request(
      new URL(path, "https://api.appstoreconnect.apple.com"),
      {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/json",
        },
      },
    );
    check(r.status === 204, "Apple screenshot retirement failed");
    return null;
  };
}
export async function inventory(api, images, requireComplete) {
  const sets = (
    await api(
      "GET",
      "/v1/appStoreVersionLocalizations/" + LOCALE_ID + "/appScreenshotSets",
    )
  ).data;
  const result = [];
  for (const [displayType, old] of Object.entries(OLD)) {
    const matches = sets.filter(
      (s) => s.attributes?.screenshotDisplayType === displayType,
    );
    check(matches.length === 1, "Expected one existing main screenshot set");
    const set = matches[0];
    check(/^[A-Za-z0-9-]+$/.test(set.id), "Invalid screenshot set identity");
    const current = (
      await api("GET", "/v1/appScreenshotSets/" + set.id + "/appScreenshots")
    ).data;
    const expected = images
      .filter((i) => i.displayType === displayType)
      .map((i) => ({ image: i, checksum: verifyImage(i.bytes, i) }));
    check(expected.length === 4, "Expected four reviewed images per family");
    const newIds = [];
    for (const { checksum } of expected) {
      const found = current.filter(
        (s) => s.attributes?.sourceFileChecksum === checksum,
      );
      check(found.length <= 1, "Duplicate replacement screenshot");
      if (requireComplete)
        check(
          found.length === 1 &&
            found[0].attributes.assetDeliveryState?.state === "COMPLETE",
          "Replacement screenshot not complete",
        );
      if (found.length) {
        check(
          found[0].attributes.assetDeliveryState?.state === "COMPLETE",
          "Prior replacement needs processing review",
        );
        newIds.push(found[0].id);
      }
    }
    check(
      current.every((s) => old.includes(s.id) || newIds.includes(s.id)),
      "Unrecognized screenshot; preserve it for review",
    );
    result.push({
      displayType,
      setId: set.id,
      oldIds: current.filter((s) => old.includes(s.id)).map((s) => s.id),
      newIds,
    });
  }
  return result;
}
export async function retireOld(api, images, report) {
  // Verify every replacement in both families before deleting any previous image.
  const before = await inventory(api, images, true);
  const version = (await api("GET", "/v1/appStoreVersions/" + VERSION_ID)).data;
  check(
    ["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED"].includes(
      version?.attributes?.appStoreState,
    ),
    "Version no longer editable",
  );
  report.retired = [];
  for (const set of before)
    for (const id of set.oldIds.filter((id) => !set.newIds.includes(id))) {
      await api("DELETE", "/v1/appScreenshots/" + id);
      report.retired.push(id);
    }
  const after = await inventory(api, images, true);
  check(
    after.every(
      (s) =>
        s.oldIds.every((id) => s.newIds.includes(id)) && s.newIds.length === 4,
    ),
    "Screenshot replacement incomplete",
  );
  report.families = after.map((s) => ({
    displayType: s.displayType,
    ids: s.newIds,
    state: "COMPLETE",
  }));
  return report;
}
async function main() {
  const report = {
    appId: APP_ID,
    version: VERSION,
    appStoreVersionId: VERSION_ID,
    images: [],
    submitted: false,
    checkedAt: new Date().toISOString(),
  };
  try {
    const manifest = JSON.parse(
      readFileSync(
        ".github/release/IOS-STORE-SCREENSHOTS-20261019.json",
        "utf8",
      ),
    );
    check(
      manifest.sourceCommit === "286e875cb488365eeb00799b6c04305994ab9db7" &&
        manifest.captureRunId === 39799093428 &&
        manifest.visuallyReviewed === true,
      "Unreviewed screenshot provenance",
    );
    check(
      manifest.images.length === 8,
      "Expected eight reviewed main screenshots",
    );
    const images = manifest.images.map((i) => ({
      ...i,
      bytes: readFileSync("verified-store/" + i.file),
    }));
    for (const image of images) verifyImage(image.bytes, image);
    const api = storeClient(
      makeToken(
        JSON.parse(process.env.APP_STORE_CONNECT_API_KEY_CONTENT || ""),
      ),
    );
    await inventory(api, images, false);
    await upload(api, images, fetch, report, manifest.images, "redwallet-app");
    await retireOld(api, images, report);
    report.sourceCommit = manifest.sourceCommit;
    report.captureRunId = manifest.captureRunId;
    report.status = "SCREENSHOTS_REPLACED";
  } catch {
    report.status = "STOPPED_FOR_REVIEW";
    report.error =
      "Main screenshot replacement stopped; inspect safe receipt before further actions";
    process.exitCode = 1;
  } finally {
    writeFileSync(
      "store-screenshot-receipt.json",
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600 },
    );
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();

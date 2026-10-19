import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { makeToken, APP_ID, VERSION } from "./inspect-ios-store.mjs";
import { client, upload, verifyImage } from "./upload-imessage-screenshots.mjs";

const VERSION_ID = "65cd6bc4-9962-4b77-a3ca-78c115f3a615";
const LOCALE_ID = "67c79fa3-be47-4fc0-94c5-713836f9d262";
export const OLD = {
  APP_IPHONE_67: [
    "6a8d2761-8d15-4964-82ad-b19e138edeaa",
    "0f3a814a-093f-4c38-b56f-5f26425bb2dc",
    "4cf5b582-9136-4c0e-a32b-272a4d789873",
    "41b6c6c7-84f7-4d84-a328-954e8f411c7d",
  ],
  APP_IPAD_PRO_3GEN_129: [
    "748ad799-0f22-4de0-bcc7-92766ebf9f2b",
    "2d166eed-a38b-420e-a00f-6c5c4d3e32a5",
    "14402526-34a8-4f57-b7b5-e45b2b8f4a62",
    "82f54f19-003a-4953-8ee9-e202bce9572b",
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
    version?.attributes?.appStoreState === "PREPARE_FOR_SUBMISSION",
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
      manifest.sourceCommit === "9f627fb87b4b6cc28cddcf6ad45e2edc721551a8" &&
        manifest.captureRunId === 39312798717 &&
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

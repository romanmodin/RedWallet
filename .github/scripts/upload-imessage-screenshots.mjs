import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { makeToken, APP_ID, BUNDLE_ID, VERSION } from "./inspect-ios-store.mjs";

const VERSION_ID = "65cd6bc4-9962-4b77-a3ca-78c115f3a615";
const LOCALE_ID = "67c79fa3-be47-4fc0-94c5-713836f9d262";
export const IMAGES = [
  {
    family: "iphone",
    displayType: "IMESSAGE_APP_IPHONE_67",
    file: "iphone.png",
    width: 1206,
    height: 2622,
    sha256: "ed3a6d94e6f2bbcfea25f9337679e35345e224b5bbeef269a31e9707a652883c",
  },
  {
    family: "ipad",
    displayType: "IMESSAGE_APP_IPAD_PRO_3GEN_129",
    file: "ipad.png",
    width: 2064,
    height: 2752,
    sha256: "caeee68897099b0902bef1547b0ca0acf2445439c3a1037e3ca843247211dc37",
  },
];
const digest = (bytes, algorithm) =>
  createHash(algorithm).update(bytes).digest("hex");
class SafeUploadError extends Error {}
function check(condition, message) {
  if (!condition) throw new SafeUploadError(message);
}
function id(value) {
  check(
    typeof value === "string" && /^[A-Za-z0-9-]+$/.test(value),
    "Invalid resource identity",
  );
  return value;
}
export function verifyImage(bytes, expected) {
  check(
    digest(bytes, "sha256") === expected.sha256,
    "Screenshot hash mismatch",
  );
  check(
    bytes.length > 24 &&
      bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
      bytes.toString("ascii", 12, 16) === "IHDR",
    "Invalid PNG",
  );
  check(
    bytes.readUInt32BE(16) === expected.width &&
      bytes.readUInt32BE(20) === expected.height,
    "Screenshot dimension mismatch",
  );
  return digest(bytes, "md5");
}
export function operation(op, size) {
  const url = new URL(op.url);
  check(
    url.protocol === "https:" &&
      url.hostname.endsWith(".apple.com") &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443"),
    "Unexpected Apple upload host",
  );
  check(
    op.method === "PUT" &&
      Number.isSafeInteger(op.offset) &&
      op.offset >= 0 &&
      Number.isSafeInteger(op.length) &&
      op.length > 0 &&
      op.offset + op.length <= size,
    "Invalid upload byte range",
  );
  const headers = {};
  for (const h of op.requestHeaders || []) {
    check(
      /^[A-Za-z0-9-]+$/.test(h.name) &&
        ![
          "authorization",
          "cookie",
          "host",
          "proxy-authorization",
          "referer",
        ].includes(h.name.toLowerCase()),
      "Unexpected upload header",
    );
    headers[h.name] = h.value;
  }
  return { url, headers };
}
export function existing(images, fileName, checksum) {
  const matches = images.filter(
    (x) =>
      x.attributes?.sourceFileChecksum === checksum ||
      x.attributes?.fileName === fileName,
  );
  check(matches.length <= 1, "Ambiguous existing screenshot");
  if (!matches.length) return null;
  check(
    matches[0].attributes.sourceFileChecksum === checksum,
    "Existing screenshot identity mismatch",
  );
  check(
    matches[0].attributes.assetDeliveryState?.state === "COMPLETE",
    "Existing screenshot needs processing review",
  );
  return matches[0];
}
export function client(token, request = fetch) {
  return async (method, path, payload) => {
    const get =
      /^\/v1\/(?:apps\/6817118871|appStoreVersions\/[A-Za-z0-9-]+(?:\/appStoreVersionLocalizations)?|appStoreVersionLocalizations\/[A-Za-z0-9-]+\/appScreenshotSets|appScreenshotSets\/[A-Za-z0-9-]+\/appScreenshots|appScreenshots\/[A-Za-z0-9-]+)$/;
    check(
      (method === "GET" && get.test(path)) ||
        (method === "POST" &&
          ["/v1/appScreenshotSets", "/v1/appScreenshots"].includes(path)) ||
        (method === "PATCH" &&
          /^\/v1\/appScreenshots\/[A-Za-z0-9-]+$/.test(path)),
      "Unexpected Apple write or resource",
    );
    const url = new URL(path, "https://api.appstoreconnect.apple.com");
    if (method === "GET") url.searchParams.set("limit", "200");
    // Single GET resources do not accept the list limit.
    if (
      !/\/(appStoreVersionLocalizations|appScreenshotSets|appScreenshots)$/.test(
        path,
      )
    )
      url.search = "";
    const r = await request(url, {
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
    check(r.ok, "Apple screenshot request failed");
    const result = await r.json();
    check(!result.links?.next, "Incomplete Apple screenshot response");
    return result;
  };
}
export async function upload(
  api,
  images,
  put = fetch,
  report = { images: [] },
  approvedImages = IMAGES,
  filePrefix = "redwallet-imessage",
) {
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
      version.attributes.appStoreState === "PREPARE_FOR_SUBMISSION",
    "Wrong or non-editable version",
  );
  const locales = (
    await api(
      "GET",
      "/v1/appStoreVersions/" + VERSION_ID + "/appStoreVersionLocalizations",
    )
  ).data;
  check(
    locales.some((x) => x.id === LOCALE_ID && x.attributes?.locale === "en-US"),
    "Wrong localization",
  );
  for (const image of images) {
    check(
      approvedImages.some(
        (x) =>
          x.file === image.file &&
          x.sha256 === image.sha256 &&
          x.displayType === image.displayType,
      ),
      "Unreviewed image",
    );
    const checksum = verifyImage(image.bytes, image);
    const sets = (
      await api(
        "GET",
        "/v1/appStoreVersionLocalizations/" + LOCALE_ID + "/appScreenshotSets",
      )
    ).data;
    const matches = sets.filter(
      (s) => s.attributes?.screenshotDisplayType === image.displayType,
    );
    check(matches.length <= 1, "Ambiguous screenshot set");
    let set = matches[0];
    if (!set)
      set = (
        await api("POST", "/v1/appScreenshotSets", {
          data: {
            type: "appScreenshotSets",
            attributes: { screenshotDisplayType: image.displayType },
            relationships: {
              appStoreVersionLocalization: {
                data: { type: "appStoreVersionLocalizations", id: LOCALE_ID },
              },
            },
          },
        })
      ).data;
    const setId = id(set.id);
    const shots = (
      await api("GET", "/v1/appScreenshotSets/" + setId + "/appScreenshots")
    ).data;
    const name =
      filePrefix +
      "-" +
      image.family +
      "-" +
      image.sha256.slice(0, 12) +
      ".png";
    const prior = existing(shots, name, checksum);
    if (prior) {
      report.images.push({
        family: image.family,
        id: id(prior.id),
        sha256: image.sha256,
        state: "COMPLETE",
        reused: true,
      });
      continue;
    }
    check(shots.length < 10, "Screenshot set is full");
    const shot = (
      await api("POST", "/v1/appScreenshots", {
        data: {
          type: "appScreenshots",
          attributes: { fileName: name, fileSize: image.bytes.length },
          relationships: {
            appScreenshotSet: {
              data: { type: "appScreenshotSets", id: setId },
            },
          },
        },
      })
    ).data;
    const shotId = id(shot.id),
      entry = {
        family: image.family,
        id: shotId,
        sha256: image.sha256,
        state: "RESERVED",
        reused: false,
      };
    report.images.push(entry);
    const ops = shot.attributes?.uploadOperations;
    check(Array.isArray(ops) && ops.length > 0, "Missing upload operations");
    let offset = 0;
    for (const op of ops) {
      operation(op, image.bytes.length);
      check(op.offset === offset, "Non-contiguous upload operations");
      offset += op.length;
    }
    check(offset === image.bytes.length, "Incomplete upload operations");
    for (const op of ops) {
      const { url, headers } = operation(op, image.bytes.length);
      const r = await put(url, {
        method: "PUT",
        headers,
        body: image.bytes.subarray(op.offset, op.offset + op.length),
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      });
      check(r.ok, "Screenshot binary upload failed");
    }
    await api("PATCH", "/v1/appScreenshots/" + shotId, {
      data: {
        type: "appScreenshots",
        id: shotId,
        attributes: { uploaded: true, sourceFileChecksum: checksum },
      },
    });
    entry.state = "COMMITTED";
    const deadline = Date.now() + 120000;
    for (;;) {
      const verified = (await api("GET", "/v1/appScreenshots/" + shotId)).data;
      const state = verified.attributes?.assetDeliveryState?.state;
      entry.state = state || "UNKNOWN";
      if (state === "COMPLETE") {
        check(
          verified.attributes.sourceFileChecksum === checksum,
          "Apple screenshot checksum mismatch",
        );
        break;
      }
      check(
        state === "UPLOAD_COMPLETE" || state === "AWAITING_UPLOAD",
        "Apple screenshot processing failed",
      );
      check(Date.now() < deadline, "Apple screenshot processing still pending");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  return report;
}
async function main() {
  const report = {
    appId: APP_ID,
    version: VERSION,
    appStoreVersionId: VERSION_ID,
    localeId: LOCALE_ID,
    captureRunId: 39238585772,
    images: [],
    submitted: false,
    checkedAt: new Date().toISOString(),
  };
  try {
    // Verify both entire files before any Apple mutation.
    const images = IMAGES.map((image) => ({
      ...image,
      bytes: readFileSync("verified-imessage/" + image.file),
    }));
    for (const image of images) verifyImage(image.bytes, image);
    const token = makeToken(
      JSON.parse(process.env.APP_STORE_CONNECT_API_KEY_CONTENT || ""),
    );
    await upload(client(token), images, fetch, report);
    report.status = "SCREENSHOTS_COMPLETE";
  } catch (error) {
    report.error =
      error instanceof SafeUploadError
        ? error.message
        : "Unexpected upload failure; no raw diagnostics emitted";
    report.status = "STOPPED_FOR_REVIEW";
    process.exitCode = 1;
    process.stderr.write(
      "Screenshot upload stopped; inspect the retained safe receipt before any further attempt. No automatic mutation retries.\n",
    );
  } finally {
    writeFileSync(
      "imessage-upload-receipt.json",
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600 },
    );
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();

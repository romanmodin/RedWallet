import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import {
  APP_ID,
  BUNDLE_ID,
  makeToken,
  reader,
  inspect,
} from "./inspect-ios-store.mjs";

test("signs a short-lived ES256 token with the existing standard API-key shape", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const token = makeToken(
    {
      key_id: "TESTKEY",
      issuer_id: "test-issuer",
      key: privateKey.export({ type: "pkcs8", format: "pem" }),
    },
    1000,
  );
  const [header, payload, signature] = token.split(".");
  assert.equal(JSON.parse(Buffer.from(payload, "base64url")).exp, 1600);
  assert.ok(
    verify(
      "sha256",
      Buffer.from(header + "." + payload),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    ),
  );
});

test("only makes GET requests to allowed Apple resources without redirects", async () => {
  const requests = [];
  const get = reader("fake-token", async (url, options) => {
    requests.push({ url: String(url), options });
    return { ok: true, json: async () => ({ data: [] }) };
  });
  for (const path of [
    "https://example.com",
    "/v1/apps/1234",
    "/v1/apps/6817118871/../other",
    "/v1/reviewSubmissions",
  ]) {
    await assert.rejects(get(path), /Unexpected Apple resource/);
  }
  await get("/v1/apps/" + APP_ID);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.redirect, "error");
  assert.equal(
    new URL(requests[0].url).origin,
    "https://api.appstoreconnect.apple.com",
  );
});

test("reports missing optional metadata but rejects HTTP and incomplete-list errors", async () => {
  assert.equal(
    (
      await reader("x", async () => ({ status: 404 }))(
        "/v1/appStoreVersions/v/build",
        {},
        true,
      )
    ).data,
    null,
  );
  await assert.rejects(
    reader("x", async () => ({ status: 403, ok: false }))("/v1/apps/" + APP_ID),
    /HTTP 403/,
  );
  await assert.rejects(
    reader("x", async () => ({
      ok: true,
      json: async () => ({ links: { next: "private-url" } }),
    }))("/v1/apps/" + APP_ID),
    /pagination/,
  );
});

function fixture() {
  return {
    ["/v1/apps/" + APP_ID]: {
      data: { id: APP_ID, attributes: { bundleId: BUNDLE_ID } },
    },
    ["/v1/apps/" + APP_ID + "/appInfos"]: {
      data: [
        {
          id: "info-id",
          attributes: {
            appStoreState: "PREPARE_FOR_SUBMISSION",
            state: "PREPARE_FOR_SUBMISSION",
            privateField: "PRIVATE",
          },
        },
      ],
    },
    "/v1/appInfos/info-id/appInfoLocalizations": {
      data: [
        {
          id: "info-locale-id",
          attributes: {
            locale: "en-US",
            privacyPolicyUrl: "https://example.com/privacy",
            privateField: "PRIVATE",
          },
        },
      ],
    },
    ["/v1/apps/" + APP_ID + "/appStoreVersions"]: {
      data: [
        {
          id: "version-id",
          attributes: {
            platform: "IOS",
            versionString: "8.0.1",
            appStoreState: "PREPARE_FOR_SUBMISSION",
          },
        },
      ],
    },
    "/v1/appStoreVersions/version-id/build": {
      data: {
        id: "old-build",
        attributes: { version: "1792401003", processingState: "VALID" },
      },
    },
    "/v1/appStoreVersions/version-id/appStoreReviewDetail": {
      data: {
        attributes: {
          contactFirstName: "PRIVATE",
          contactLastName: "PRIVATE",
          contactEmail: "PRIVATE",
          contactPhone: "PRIVATE",
          notes: "PRIVATE",
          demoAccountRequired: false,
          demoAccountName: "PRIVATE",
          demoAccountPassword: "PRIVATE",
        },
      },
    },
    "/v1/appStoreVersions/version-id/appStoreVersionLocalizations": {
      data: [
        {
          id: "locale-id",
          attributes: {
            locale: "en-US",
            description: "PRIVATE",
            keywords: "PRIVATE",
            supportUrl: "PRIVATE",
          },
        },
      ],
    },
    "/v1/appStoreVersionLocalizations/locale-id/appScreenshotSets": {
      data: [
        {
          id: "set-id",
          attributes: { screenshotDisplayType: "APP_IPHONE_67" },
        },
      ],
    },
    "/v1/appScreenshotSets/set-id/appScreenshots": {
      data: [
        {
          id: "image-id",
          attributes: {
            fileName: "PRIVATE",
            assetDeliveryState: { state: "COMPLETE" },
          },
        },
      ],
    },
  };
}

test("snapshot never outputs private review data or mistakes the old selected build for new qualification", async () => {
  const f = fixture();
  const result = await inspect(
    async (path) => structuredClone(f[path]),
    "test-time",
  );
  assert.equal(result.selectedBuild.build, "1792401003");
  assert.equal(result.review.contactComplete, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.submittedByThisRun, false);
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
});

test("wrong app and duplicate versions fail before reading review contacts", async () => {
  const f = fixture();
  f["/v1/apps/" + APP_ID].data.attributes.bundleId = "other.app";
  await assert.rejects(
    inspect(async (path) => f[path]),
    /Wrong Apple app/,
  );
  const g = fixture(),
    versions = g["/v1/apps/" + APP_ID + "/appStoreVersions"].data;
  versions.push(versions[0]);
  await assert.rejects(
    inspect(async (path) => g[path]),
    /exactly one/,
  );
});

test("retains safe processing errors and checksums without signed delivery URLs", async () => {
  const f = fixture();
  const a = f["/v1/appScreenshotSets/set-id/appScreenshots"].data[0].attributes;
  a.sourceFileChecksum = "abc";
  a.assetDeliveryState = {
    state: "FAILED",
    errors: [
      {
        code: "IMAGE_INVALID_DIMENSIONS",
        description:
          "Image dimensions invalid. https://upload.apple.com/private",
      },
    ],
  };
  const result = await inspect(async (path) => structuredClone(f[path]));
  const image = result.localizations[0].screenshots[0].images[0];
  assert.equal(image.state, "FAILED");
  assert.equal(image.checksum, "abc");
  assert.equal(image.processingErrors[0].code, "IMAGE_INVALID_DIMENSIONS");
  assert.equal(JSON.stringify(result).includes("upload.apple.com"), false);
});

test("observes app information independently from version review status without exposing other fields", async () => {
  const f = fixture();
  f[
    "/v1/apps/" + APP_ID + "/appStoreVersions"
  ].data[0].attributes.appStoreState = "DEVELOPER_REJECTED";
  const result = await inspect(async (path) => structuredClone(f[path]));
  assert.equal(result.appStoreState, "DEVELOPER_REJECTED");
  assert.deepEqual(result.appInfos, [
    {
      id: "info-id",
      appStoreState: "PREPARE_FOR_SUBMISSION",
      state: "PREPARE_FOR_SUBMISSION",
      localizations: [
        {
          id: "info-locale-id",
          locale: "en-US",
          privacyPolicyUrl: "https://example.com/privacy",
        },
      ],
    },
  ]);
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  const calls = [];
  const get = reader("fake", async (url, options) => {
    calls.push(options.method);
    return { ok: true, json: async () => ({ data: [] }) };
  });
  await get("/v1/apps/" + APP_ID + "/appInfos");
  await get("/v1/appInfos/info-id/appInfoLocalizations");
  assert.deepEqual(calls, ["GET", "GET"]);
});

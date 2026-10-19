import test from "node:test";
import assert from "node:assert/strict";
import { verifyReceipts, submit, client } from "./submit-ios-store.mjs";
const APP = "6817118871",
  V = "65cd6bc4-9962-4b77-a3ca-78c115f3a615",
  L = "67c79fa3-be47-4fc0-94c5-713836f9d262";
function fixture() {
  const c = {
      build: "new-build-number",
      appleBuildId: "new-build-id",
      ipaSha256: "hash",
      images: [],
    },
    writes = [];
  let state = "PREPARE_FOR_SUBMISSION",
    selected = "0c79c478-9b0f-4017-a62f-499e8d5e7143",
    policy = "https://github.com/romanmodin/RedWallet/blob/old/docs/PRIVACY.md",
    reviews = [],
    items = [];
  const sets = Object.entries({
    APP_IPHONE_67: 4,
    APP_IPAD_PRO_3GEN_129: 4,
    IMESSAGE_APP_IPHONE_67: 1,
    IMESSAGE_APP_IPAD_PRO_3GEN_129: 1,
  }).map(([s, n]) => ({
    id: s.replaceAll("_", "-"),
    attributes: { screenshotDisplayType: s },
    count: n,
  }));
  const shots = {};
  for (const s of sets) {
    shots[s.id] = Array.from({ length: s.count }, (_, i) => ({
      id: s.id + i,
      attributes: { assetDeliveryState: { state: "COMPLETE" } },
    }));
    c.images.push(...shots[s.id].map((x) => ({ id: x.id, state: "COMPLETE" })));
  }
  const api = async (method, path, payload, query) => {
    if (method === "GET" && path.endsWith("/items"))
      assert.equal(
        query?.include,
        "appStoreVersion",
        "Request the item relationship before checking its identity",
      );
    if (method !== "GET") writes.push({ method, path, payload });
    if (method === "PATCH" && path.endsWith("/relationships/build")) {
      selected = payload.data.id;
      return {};
    }
    if (method === "PATCH" && path === "/v1/appInfoLocalizations/info-locale") {
      policy = payload.data.attributes.privacyPolicyUrl;
      return {};
    }
    if (method === "POST" && path === "/v1/reviewSubmissions") {
      const r = { id: "review-id", attributes: { state: "READY_FOR_REVIEW" } };
      reviews = [r];
      return { data: structuredClone(r) };
    }
    if (method === "POST" && path === "/v1/reviewSubmissionItems") {
      items = [{ id: "item-id", relationships: payload.data.relationships }];
      state = "READY_FOR_REVIEW";
      return { data: items[0] };
    }
    if (method === "PATCH" && path === "/v1/reviewSubmissions/review-id") {
      assert.deepEqual(payload.data.attributes, { submitted: true });
      reviews[0].attributes.state = "WAITING_FOR_REVIEW";
      state = "WAITING_FOR_REVIEW";
      return { data: reviews[0] };
    }
    assert.equal(method, "GET", "Unexpected write " + path);
    const resources = {
      ["/v1/apps/" + APP]: {
        id: APP,
        attributes: { bundleId: "com.romanmodin.redwallet" },
      },
      ["/v1/appStoreVersions/" + V]: {
        id: V,
        attributes: {
          versionString: "8.0.1",
          platform: "IOS",
          releaseType: "AFTER_APPROVAL",
          appStoreState: state,
        },
      },
      ["/v1/builds/new-build-id"]: {
        id: "new-build-id",
        attributes: {
          version: c.build,
          processingState: "VALID",
          expired: false,
          usesNonExemptEncryption: false,
        },
      },
      ["/v1/builds/new-build-id/app"]: { id: APP },
      ["/v1/builds/new-build-id/preReleaseVersion"]: {
        attributes: { version: "8.0.1", platform: "IOS" },
      },
      ["/v1/appStoreVersions/" + V + "/build"]: { id: selected },
      ["/v1/appStoreVersions/" + V + "/appStoreReviewDetail"]: {
        attributes: Object.fromEntries(
          [
            "contactFirstName",
            "contactLastName",
            "contactPhone",
            "contactEmail",
            "notes",
          ]
            .map((k) => [k, "PRIVATE"])
            .concat([["demoAccountRequired", false]]),
        ),
      },
      ["/v1/appStoreVersions/" + V + "/appStoreVersionLocalizations"]: [
        {
          id: L,
          attributes: {
            locale: "en-US",
            description: "PRIVATE",
            keywords: "PRIVATE",
            supportUrl: "PRIVATE",
          },
        },
      ],
      ["/v1/appStoreVersionLocalizations/" + L + "/appScreenshotSets"]: sets,
      ["/v1/apps/" + APP + "/appInfos"]: [
        { id: "info", attributes: { appStoreState: state } },
      ],
      ["/v1/appInfos/info/appInfoLocalizations"]: [
        {
          id: "info-locale",
          attributes: { locale: "en-US", privacyPolicyUrl: policy },
        },
      ],
      ["/v1/apps/" + APP + "/reviewSubmissions"]: reviews,
      ["/v1/reviewSubmissions/review-id/items"]: items,
      ["/v1/reviewSubmissions/review-id"]: reviews[0],
    };
    for (const [id, list] of Object.entries(shots))
      resources["/v1/appScreenshotSets/" + id + "/appScreenshots"] = list;
    assert.ok(path in resources, path);
    return { data: structuredClone(resources[path]) };
  };
  return { c, api, writes, shots, setSelected: (x) => (selected = x) };
}
test("old or unsigned package receipts cannot qualify an Apple submission", () => {
  const ipa = { sourceCommit: "old" };
  assert.throws(() => verifyReceipts(ipa, {}, {}, {}), /Unqualified/);
});
test("incomplete actual screenshots stop before every metadata or submission mutation", async () => {
  const f = fixture();
  Object.values(f.shots).at(-1)[0].attributes.assetDeliveryState.state =
    "FAILED";
  await assert.rejects(submit(f.api, f.c, {}), /screenshots differ/);
  assert.equal(f.writes.length, 0);
});
test("an unexpectedly selected build is preserved", async () => {
  const f = fixture();
  f.setSelected("another-user-selected-build");
  await assert.rejects(submit(f.api, f.c, {}), /Unexpected selected build/);
  assert.equal(f.writes.length, 0);
});
test("selects the qualified build and policy, submits only this version, and verifies the returned state without duplicate submission", async () => {
  const f = fixture(),
    report = {};
  await submit(f.api, f.c, report);
  assert.equal(report.status, "SUBMITTED_FOR_APP_REVIEW");
  assert.equal(report.selectedBuild, "new-build-id");
  assert.equal(report.reviewState, "WAITING_FOR_REVIEW");
  assert.equal(JSON.stringify(report).includes("PRIVATE"), false);
  assert.equal(
    f.writes.filter((w) => w.path === "/v1/reviewSubmissionItems").length,
    1,
  );
  f.writes.length = 0;
  await submit(f.api, f.c, {});
  assert.equal(f.writes.length, 0);
});
test("submission client rejects agreements, other apps, build uploads, and arbitrary redirects", async () => {
  let calls = 0;
  const api = client("fake", async () => {
    calls++;
    return { status: 204, ok: true };
  });
  for (const [method, path] of [
    ["POST", "/v1/agreements"],
    ["PATCH", "/v1/apps/123"],
    ["POST", "/v1/builds"],
    ["GET", "https://example.com"],
  ])
    await assert.rejects(api(method, path), /Unexpected/);
  assert.equal(calls, 0);
});

// Negative receipt cases cover stale or unrelated captures before any Apple write.
test("submission receipts must belong to the exact signed release and both reviewed screenshot families", () => {
  const source = "9f627fb87b4b6cc28cddcf6ad45e2edc721551a8";
  const ipa = {
    sourceCommit: source,
    publicSourceCommit: source,
    orchestrationCommit: "2e48763dfe0b1dd90763c47323143af527bd8148",
    signatureVerification: "passed",
    sourceMappingVerification: "passed",
    ipaSha256:
      "1f35c12670d95c54dd7f960b9b9b7d09b12fda8ff7d7ca64e3003998f8784dd0",
    bundles: [
      "com.romanmodin.redwallet",
      "com.romanmodin.redwallet.Stickers",
    ].map((bundleId) => ({ bundleId, version: "8.0.1", build: "1792439689" })),
  };
  const beta = {
    sourceCommit: source,
    uploadRunId: "39312792179",
    ipaSha256: ipa.ipaSha256,
    processingState: "VALID",
    appId: APP,
    bundleId: "com.romanmodin.redwallet",
    version: "8.0.1",
    appleBuildId: "new-build-id",
    build: "1792439689",
  };
  const identity = {
    appId: APP,
    version: "8.0.1",
    appStoreVersionId: V,
    sourceCommit: source,
  };
  const shots = {
    ...identity,
    status: "SCREENSHOTS_REPLACED",
    captureRunId: 39312798717,
    images: ["iphone", "ipad"].flatMap((family) =>
      Array.from({ length: 4 }, (_, i) => ({
        family,
        id: family + i,
        state: "COMPLETE",
      })),
    ),
  };
  const message = {
    ...identity,
    status: "SCREENSHOTS_COMPLETE",
    captureRunId: 39319942381,
    images: ["iphone", "ipad"].map((family) => ({
      family,
      id: "message-" + family,
      state: "COMPLETE",
    })),
  };
  assert.equal(verifyReceipts(ipa, beta, shots, message).build, "1792439689");
  assert.throws(
    () => verifyReceipts(ipa, beta, shots, { ...message, sourceCommit: "old" }),
    /iMessage/,
  );
  assert.throws(
    () => verifyReceipts(ipa, beta, { ...shots, appId: "another" }, message),
    /Main screenshots/,
  );
  assert.throws(
    () =>
      verifyReceipts(ipa, beta, shots, {
        ...message,
        images: message.images.map((i) => ({ ...i, family: "iphone" })),
      }),
    /family/,
  );
  assert.throws(
    () =>
      verifyReceipts({ ...ipa, ipaSha256: "another" }, beta, shots, message),
    /signed package/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  verifyReceipts,
  submit,
  client,
  replaceAndSubmit,
  v4ReviewNotes,
  V4_REVIEW_NOTE,
  COINJOIN_KNOWN_ISSUE_NOTE,
} from "./submit-ios-store.mjs";
import {
  REPLACEMENT_SOURCE,
  OLD_BUILD,
  OLD_REVIEW,
  withdrawSupersededReview,
} from "./replace-ios-review.mjs";
const APP = "6817118871",
  V = "65cd6bc4-9962-4b77-a3ca-78c115f3a615",
  L = "67c79fa3-be47-4fc0-94c5-713836f9d262";
function fixture(options = {}) {
  const c = {
      build: options.replacement ? "1792700000" : "new-build-number",
      sourceCommit: options.replacement ? REPLACEMENT_SOURCE : undefined,
      appleBuildId: "new-build-id",
      ipaSha256: "hash",
      images: [],
    },
    writes = [];
  let state = options.replacement
      ? "WAITING_FOR_REVIEW"
      : "PREPARE_FOR_SUBMISSION",
    selected = options.replacement
      ? OLD_BUILD
      : "0c79c478-9b0f-4017-a62f-499e8d5e7143",
    policy = "https://github.com/romanmodin/RedWallet/blob/old/docs/PRIVACY.md",
    reviews = options.replacement
      ? [{ id: OLD_REVIEW, attributes: { state: "WAITING_FOR_REVIEW" } }]
      : [],
    notes = options.longNotes ? "N".repeat(4000) : "PRIVATE",
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
    assert.equal(
      path.endsWith("/betaGroups"),
      false,
      "Use the documented build include relationship",
    );
    if (
      method === "GET" &&
      path === "/v1/builds/new-build-id" &&
      query?.include === "betaGroups"
    ) {
      const groups = [
        "0bc2722a-48b6-4520-871d-dd5a4a8988cb",
        "463ff340-3283-4f17-949d-39c7aa929da2",
      ].map((id) => ({ id, type: "betaGroups" }));
      return {
        data: {
          id: c.appleBuildId,
          attributes: { version: c.build },
          relationships: { betaGroups: { data: groups } },
        },
        included: groups,
      };
    }
    if (method === "GET" && path.endsWith("/items"))
      assert.equal(
        query?.include,
        "appStoreVersion",
        "Request the item relationship before checking its identity",
      );
    if (method !== "GET") writes.push({ method, path, payload });
    if (method === "PATCH" && path === "/v1/reviewSubmissions/" + OLD_REVIEW) {
      assert.deepEqual(payload.data.attributes, { canceled: true });
      reviews[0].attributes.state = options.pendingCancellation
        ? "CANCELING"
        : "COMPLETE";
      if (!options.pendingCancellation) state = "DEVELOPER_REJECTED";
      return {};
    }
    if (method === "PATCH" && path.endsWith("/relationships/build")) {
      selected = payload.data.id;
      if (options.resetStateAfterBuildSelection)
        state = "PREPARE_FOR_SUBMISSION";
      return {};
    }
    if (method === "PATCH" && path === "/v1/appInfoLocalizations/info-locale") {
      policy = payload.data.attributes.privacyPolicyUrl;
      return {};
    }
    if (
      method === "PATCH" &&
      path === "/v1/appStoreReviewDetails/review-detail"
    ) {
      assert.deepEqual(Object.keys(payload.data.attributes), ["notes"]);
      notes = payload.data.attributes.notes;
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
      ["/v1/builds/new-build-id/buildBetaDetail"]: {
        attributes: {
          internalBuildState: "IN_BETA_TESTING",
          externalBuildState: options.undelivered
            ? "WAITING_FOR_REVIEW"
            : "IN_BETA_TESTING",
        },
      },
      ["/v1/builds/new-build-id/betaGroups"]: [
        "0bc2722a-48b6-4520-871d-dd5a4a8988cb",
        "463ff340-3283-4f17-949d-39c7aa929da2",
      ].map((id) => ({ id })),
      ["/v1/reviewSubmissions/" + OLD_REVIEW]: reviews.find(
        (r) => r.id === OLD_REVIEW,
      ),
      ["/v1/reviewSubmissions/" + OLD_REVIEW + "/items"]: [
        {
          id: "old-item",
          relationships: { appStoreVersion: { data: { id: V } } },
        },
      ],
      ["/v1/appStoreVersions/" + V + "/build"]: { id: selected },
      ["/v1/appStoreVersions/" + V + "/appStoreReviewDetail"]: {
        id: "review-detail",
        attributes: Object.fromEntries(
          [
            "contactFirstName",
            "contactLastName",
            "contactPhone",
            "contactEmail",
            "notes",
          ]
            .map((k) => [k, k === "notes" ? notes : "PRIVATE"])
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
        {
          id: "info",
          attributes: {
            appStoreState: options.deprecatedInfoState ?? state,
            state,
          },
        },
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
  const source = "14b44bf69a346e1a0787e6aed1f3d3343950a0f1";
  const ipa = {
    sourceCommit: source,
    publicSourceCommit: source,
    orchestrationCommit: "d9af98430004a04e521a98b52780b8e79be1565f",
    signatureVerification: "passed",
    sourceMappingVerification: "passed",
    ipaSha256:
      "1a53b6670fe1e8f7bb864b7e1b6a4777fdd3b758eb93254e2cca4018e95cbedc",
    bundles: [
      "com.romanmodin.redwallet",
      "com.romanmodin.redwallet.Stickers",
    ].map((bundleId) => ({
      bundleId,
      version: "8.0.1",
      build: "1792915404",
      architectures: ["arm64"],
    })),
  };
  const beta = {
    sourceCommit: source,
    uploadRunId: "40174840984",
    ipaSha256: ipa.ipaSha256,
    processingState: "VALID",
    status: "AVAILABLE_TO_TESTERS",
    internalBuildState: "IN_BETA_TESTING",
    externalBuildState: "IN_BETA_TESTING",
    groups: [
      "0bc2722a-48b6-4520-871d-dd5a4a8988cb",
      "463ff340-3283-4f17-949d-39c7aa929da2",
    ].map((id) => ({ id, assigned: true })),
    appId: APP,
    bundleId: "com.romanmodin.redwallet",
    version: "8.0.1",
    appleBuildId: "new-build-id",
    build: "1792915404",
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
    captureRunId: 40184204898,
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
    sourceCommit: "9f627fb87b4b6cc28cddcf6ad45e2edc721551a8",
    status: "SCREENSHOTS_COMPLETE",
    captureRunId: 39319942381,
    images: ["iphone", "ipad"].map((family) => ({
      family,
      id: "message-" + family,
      state: "COMPLETE",
    })),
  };
  const reuse = {
    previousSourceCommit: "9f627fb87b4b6cc28cddcf6ad45e2edc721551a8",
    replacementSourceCommit: source,
    previousIosTree: "30e39cdee442e7d716cdc95de44ada6df2a523b7",
    replacementIosTree: "30e39cdee442e7d716cdc95de44ada6df2a523b7",
    newPackageVerificationPending: false,
    signedPackageRunId: 40174840984,
    signedPackageBuild: beta.build,
  };
  const verify = (i, b, s, m, r = reuse) => verifyReceipts(i, b, s, m, r);
  assert.equal(verify(ipa, beta, shots, message).build, "1792915404");
  assert.throws(
    () => verify(ipa, beta, shots, { ...message, sourceCommit: "old" }),
    /iMessage/,
  );
  assert.throws(
    () => verify(ipa, beta, { ...shots, appId: "another" }, message),
    /Main screenshots/,
  );
  assert.throws(
    () =>
      verify(ipa, beta, shots, {
        ...message,
        images: message.images.map((i) => ({ ...i, family: "iphone" })),
      }),
    /family/,
  );
  assert.throws(
    () => verify({ ...ipa, ipaSha256: "another" }, beta, shots, message),
    /signed package/,
  );
  assert.throws(
    () =>
      verify(
        ipa,
        { ...beta, externalBuildState: "WAITING_FOR_REVIEW" },
        shots,
        message,
      ),
    /Apple build/,
  );
  assert.throws(
    () =>
      verify(ipa, beta, shots, message, {
        ...reuse,
        newPackageVerificationPending: true,
      }),
    /iMessage source/,
  );
  assert.throws(
    () =>
      verify(ipa, beta, shots, message, {
        ...reuse,
        replacementIosTree: "different",
      }),
    /iMessage source/,
  );
});

test("replacement preflights screenshots and beta delivery, withdraws only old review, then submits the new build", async () => {
  const f = fixture({ replacement: true }),
    report = {};
  await replaceAndSubmit(f.api, f.c, report);
  assert.equal(report.submitted, true);
  assert.equal(report.replacementStatus, "OLD_REVIEW_REMOVAL_VERIFIED");
  assert.equal(report.selectedBuild, f.c.appleBuildId);
  assert.equal(f.writes[0].path, "/v1/reviewSubmissions/" + OLD_REVIEW);
  assert.deepEqual(f.writes[0].payload.data.attributes, { canceled: true });
  assert.equal(
    f.writes.filter((w) => w.path === "/v1/reviewSubmissions/" + OLD_REVIEW)
      .length,
    1,
  );
  f.writes.length = 0;
  await replaceAndSubmit(f.api, f.c, {});
  assert.equal(f.writes.length, 0);
});
test("replacement missing a complete screenshot preserves the old submission", async () => {
  const f = fixture({ replacement: true });
  Object.values(f.shots)[0][0].attributes.assetDeliveryState.state = "FAILED";
  await assert.rejects(replaceAndSubmit(f.api, f.c, {}), /screenshots differ/);
  assert.equal(f.writes.length, 0);
});
test("replacement not delivered to TestFlight preserves the old submission", async () => {
  const f = fixture({ replacement: true, undelivered: true });
  await assert.rejects(replaceAndSubmit(f.api, f.c, {}), /TestFlight/);
  assert.equal(f.writes.length, 0);
});
test("pending old review cancellation stops without selecting or submitting the new build", async () => {
  const f = fixture({ replacement: true, pendingCancellation: true }),
    report = {};
  await replaceAndSubmit(f.api, f.c, report);
  assert.equal(report.replacementStatus, "WAITING_FOR_OLD_REVIEW_REMOVAL");
  assert.equal(f.writes.length, 1);
  assert.equal(report.submitted, undefined);
});
test("replacement client supports only the additional read-only beta checks", async () => {
  const seen = [];
  const api = client("fake", async (url, options) => {
    seen.push([url.pathname, options.method]);
    return { status: 200, ok: true, json: async () => ({ data: {} }) };
  });
  for (const tail of ["buildBetaDetail", "betaGroups"])
    await api("GET", "/v1/builds/new-build-id/" + tail);
  assert.deepEqual(
    seen.map((x) => x[1]),
    ["GET", "GET"],
  );
  await assert.rejects(
    api("PATCH", "/v1/builds/new-build-id/betaGroups", {}),
    /Unexpected/,
  );
});

test("V4 notes preserve prior text and are idempotent", () => {
  const n = v4ReviewNotes("Existing private contact and review context");
  assert.equal(
    n,
    "Existing private contact and review context\n\n" +
      V4_REVIEW_NOTE +
      "\n\n" +
      COINJOIN_KNOWN_ISSUE_NOTE,
  );
  assert.equal(v4ReviewNotes(n), n);
  assert.throws(() => v4ReviewNotes("X".repeat(4000)), /limit/);
});
test("known CoinJoin issue is added once to existing V4 notes without losing prior text", () => {
  const existing = "Existing review context\n\n" + V4_REVIEW_NOTE;
  const result = v4ReviewNotes(existing);
  assert.equal(result, existing + "\n\n" + COINJOIN_KNOWN_ISSUE_NOTE);
  assert.equal(v4ReviewNotes(result), result);
});
test("known CoinJoin issue is confirmed by read-back before submission is reported", async () => {
  const f = fixture(),
    report = {};
  await submit(f.api, f.c, report);
  const noteWrites = f.writes.filter(
    (w) => w.path === "/v1/appStoreReviewDetails/review-detail",
  );
  assert.equal(noteWrites.length, 1);
  assert.ok(
    noteWrites[0].payload.data.attributes.notes.includes(
      COINJOIN_KNOWN_ISSUE_NOTE,
    ),
  );
  assert.equal(report.knownCoinJoinIssueDisclosed, true);
  assert.equal(report.submitted, true);
});
test("oversized notes stop before build selection or metadata writes", async () => {
  const f = fixture({ longNotes: true });
  await assert.rejects(submit(f.api, f.c, {}), /limit/);
  assert.equal(f.writes.length, 0);
});
test("review detail patch cannot change contacts or credentials", async () => {
  let calls = 0;
  const api = client("fake", async () => {
    calls++;
    return { status: 204, ok: true };
  });
  await assert.rejects(
    api("PATCH", "/v1/appStoreReviewDetails/review-detail", {
      data: {
        type: "appStoreReviewDetails",
        id: "review-detail",
        attributes: { contactEmail: "changed" },
      },
    }),
    /Only reviewer notes/,
  );
  assert.equal(calls, 0);
});

test("read-only replacement preflight completes all live checks without canceling or selecting", async () => {
  const f = fixture({ replacement: true }),
    report = {};
  await withdrawSupersededReview(f.api, f.c, report, { readOnly: true });
  assert.equal(report.replacementStatus, "WITHDRAWAL_PREFLIGHT_PASSED");
  assert.equal(report.readOnly, true);
  assert.equal(report.withdrawalRequested, undefined);
  assert.equal(f.writes.length, 0);
});

test("refreshes metadata status when selecting the replacement build resets the withdrawn version", async () => {
  const f = fixture({ replacement: true, resetStateAfterBuildSelection: true });
  const report = {};
  await replaceAndSubmit(f.api, f.c, report);
  assert.equal(report.status, "SUBMITTED_FOR_APP_REVIEW");
  assert.equal(report.knownCoinJoinIssueDisclosed, true);
  assert.equal(report.reviewState, "WAITING_FOR_REVIEW");
  f.writes.length = 0;
  await replaceAndSubmit(f.api, f.c, {});
  assert.equal(f.writes.length, 0);
});
test("uses Apple's current app-info state when its deprecated field differs", async () => {
  const f = fixture({ deprecatedInfoState: "NOT_APPLICABLE" });
  const report = {};
  await submit(f.api, f.c, report);
  assert.equal(report.status, "SUBMITTED_FOR_APP_REVIEW");
});
test("unexpected version changes stop before privacy or review submission writes", async () => {
  for (const change of ["identity", "state"]) {
    const f = fixture();
    let reads = 0;
    const api = async (...args) => {
      const response = await f.api(...args);
      if (
        args[0] === "GET" &&
        args[1] === "/v1/appStoreVersions/" + V &&
        ++reads === 2
      ) {
        if (change === "identity") response.data.id = "other-version";
        else response.data.attributes.appStoreState = "IN_REVIEW";
      }
      return response;
    };
    await assert.rejects(
      submit(api, f.c, {}),
      /Version (identity|state) changed/,
    );
    assert.equal(
      f.writes.some((w) =>
        /appInfoLocalizations|reviewSubmissions|reviewSubmissionItems/.test(
          w.path,
        ),
      ),
      false,
    );
  }
});
test("multiple matching app-info records still stop before policy or submission writes", async () => {
  const f = fixture();
  const api = async (...args) => {
    const response = await f.api(...args);
    if (args[0] === "GET" && args[1] === "/v1/apps/" + APP + "/appInfos")
      response.data.push({ ...response.data[0], id: "another-info" });
    return response;
  };
  await assert.rejects(submit(api, f.c, {}), /Ambiguous app information/);
  assert.equal(
    f.writes.some((w) =>
      /appInfoLocalizations|reviewSubmissions|reviewSubmissionItems/.test(
        w.path,
      ),
    ),
    false,
  );
});

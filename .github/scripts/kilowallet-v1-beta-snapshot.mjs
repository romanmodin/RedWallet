import assert from "node:assert/strict";
import { APP, GROUPS, validateUpload } from "./kilowallet-v1-beta-plan.mjs";
const ROOT = "https://api.appstoreconnect.apple.com";
const id = (value) => {
  assert.match(value, /^[A-Za-z0-9-]+$/);
  return value;
};
function resource(body, type, expected) {
  const d = body?.data;
  assert.equal(d?.type, type);
  assert.equal(d?.id, expected);
  return d;
}
function relation(d, name, type) {
  const ref = d.relationships?.[name]?.data;
  assert.equal(ref?.type, type);
  return id(ref.id);
}
export async function collection(get, path, type) {
  const base = new URL(path, ROOT),
    seenPages = new Set(),
    seenIds = new Set(),
    out = [];
  assert.equal(base.origin, ROOT);
  assert.ok(!base.username && !base.password && !base.hash);
  let next = path,
    total;
  for (let i = 0; i < 10; i++) {
    const u = new URL(next, ROOT);
    assert.equal(u.origin, ROOT);
    assert.equal(u.pathname, base.pathname);
    assert.ok(!u.username && !u.password && !u.hash);
    const key = u.pathname + u.search;
    assert.ok(!seenPages.has(key), "Cyclic pagination");
    seenPages.add(key);
    const page = await get(key);
    assert.ok(Array.isArray(page.data));
    if (page.meta?.paging?.total !== undefined) {
      assert.ok(
        Number.isSafeInteger(page.meta.paging.total) &&
          page.meta.paging.total >= 0,
      );
      if (total !== undefined)
        assert.equal(
          total,
          page.meta.paging.total,
          "Changing pagination total",
        );
      total = page.meta.paging.total;
    }
    for (const d of page.data) {
      assert.equal(d.type, type);
      id(d.id);
      assert.ok(!seenIds.has(d.id), "Duplicate collection member");
      seenIds.add(d.id);
      out.push(d);
    }
    if (!page.links?.next) {
      if (total !== undefined)
        assert.equal(out.length, total, "Truncated collection");
      return out;
    }
    next = page.links.next;
  }
  throw Error("Incomplete pagination");
}
// Injected GET reader only: no CLI, credentials, HTTP transport or mutations.
export async function readSnapshot(get, upload, now = () => Date.now()) {
  validateUpload(upload);
  const observedAt = new Date(now()).toISOString(),
    buildId = id(upload.appleBuildId);
  const app = resource(await get("/v1/apps/" + APP), "apps", APP);
  assert.equal(app.attributes?.bundleId, "com.kilombino.kilowallet");
  const build = resource(
    await get(
      "/v1/builds/" +
        buildId +
        "?include=app,preReleaseVersion,appEncryptionDeclaration,buildBetaDetail,betaAppReviewSubmission",
    ),
    "builds",
    buildId,
  );
  assert.equal(relation(build, "app", "apps"), APP);
  assert.equal(build.attributes?.version, upload.build);
  const includedBody = await get(
    "/v1/builds/" + buildId + "/preReleaseVersion",
  );
  const train = resource(
    includedBody,
    "preReleaseVersions",
    relation(build, "preReleaseVersion", "preReleaseVersions"),
  );
  assert.equal(train.attributes?.version, "1.0.0");
  assert.equal(train.attributes?.platform, "IOS");
  const detail = resource(
    await get("/v1/builds/" + buildId + "/buildBetaDetail"),
    "buildBetaDetails",
    relation(build, "buildBetaDetail", "buildBetaDetails"),
  );
  assert.ok(Object.hasOwn(build.relationships || {}, "appEncryptionDeclaration"), "Missing encryption relationship");
  const declarationRef = build.relationships.appEncryptionDeclaration.data;
  let declarationId = null, declaration = null;
  if (declarationRef !== null) {
    declarationId = relation(build, "appEncryptionDeclaration", "appEncryptionDeclarations");
    declaration = resource(await get("/v1/appEncryptionDeclarations/" + declarationId + "?include=app"), "appEncryptionDeclarations", declarationId);
    assert.equal(relation(declaration, "app", "apps"), APP);
  }
  let review = null;
  const reviewRef = build.relationships?.betaAppReviewSubmission?.data;
  if (reviewRef) {
    assert.equal(reviewRef.type, "betaAppReviewSubmissions");
    const r = resource(
      await get(
        "/v1/betaAppReviewSubmissions/" + id(reviewRef.id) + "?include=build",
      ),
      "betaAppReviewSubmissions",
      reviewRef.id,
    );
    assert.equal(relation(r, "build", "builds"), buildId);
    review = { buildId, state: r.attributes?.betaReviewState };
  }
  const assigned = await collection(
    get,
    "/v1/betaGroups?filter%5Bapp%5D=" + APP + "&filter%5Bbuilds%5D=" + buildId + "&limit=200",
    "betaGroups",
  );
  assert.ok(
    assigned.every((g) => GROUPS.some((e) => e.id === g.id)),
    "Foreign assigned group",
  );
  const groups = [];
  for (const expected of GROUPS) {
    const path = "/v1/betaGroups/" + expected.id;
    const g = resource(
      await get(path + "?include=app"),
      "betaGroups",
      expected.id,
    );
    assert.equal(relation(g, "app", "apps"), APP);
    assert.equal(g.attributes?.name, expected.name);
    assert.equal(g.attributes?.isInternalGroup, expected.internal);
    const builds = await collection(get, path + "/builds?limit=200", "builds");
    groups.push({
      id: g.id,
      appId: APP,
      name: g.attributes.name,
      isInternalGroup: g.attributes.isInternalGroup,
      buildListComplete: true,
      buildIds: builds.map((b) => b.id),
    });
  }
  const localizations = await collection(
    get,
    "/v1/builds/" + buildId + "/betaBuildLocalizations?limit=200",
    "betaBuildLocalizations",
  );
  return {
    complete: true,
    observedAt,
    app: { id: APP, bundleId: app.attributes.bundleId },
    build: {
      id: buildId,
      appId: APP,
      version: build.attributes.version,
      marketingVersion: train.attributes.version,
      platform: train.attributes.platform,
      processingState: build.attributes.processingState,
      expired: build.attributes.expired,
      usesNonExemptEncryption: build.attributes.usesNonExemptEncryption,
      declarationId,
    },
    declaration: declaration ? {
      id: declarationId,
      appId: APP,
      state: declaration.attributes?.appEncryptionDeclarationState,
    } : null,
    internalState: detail.attributes?.internalBuildState,
    externalState: detail.attributes?.externalBuildState,
    review,
    groups,
    assignedGroups: assigned.map((g) => g.id),
    localizationsComplete: true,
    localizations: localizations.map((l) => ({
      id: l.id,
      buildId,
      locale: l.attributes?.locale,
      whatsNew: l.attributes?.whatsNew,
    })),
  };
}

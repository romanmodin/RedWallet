import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import {
  APP,
  GROUPS,
  validateUpload,
  planDistribution,
} from "./kilowallet-v1-beta-plan.mjs";
import { readSnapshot } from "./kilowallet-v1-beta-snapshot.mjs";
import { PRIOR_BUILD } from "./kilowallet-v1-beta-prior-review.mjs";
const ROOT = "https://api.appstoreconnect.apple.com";
const validId = (x) => typeof x === "string" && /^[A-Za-z0-9-]+$/.test(x);
// No entry point or credential loading: only a protected qualified caller can use this client.
export function clients(
  token,
  upload,
  notes,
  journal,
  request = fetch,
  now = () => Date.now(),
) {
  validateUpload(upload);
  assert.equal(typeof token, "string");
  assert.ok(token.length > 0 && !/[\r\n]/.test(token));
  assert.equal(typeof notes, "string");
  assert.ok(notes.trim() && Buffer.byteLength(notes) <= 4000);
  assert.equal(typeof journal, "function");
  // Detach the qualification from caller mutations after validation.
  upload = structuredClone(upload);
  const base = "/v1/builds/" + upload.appleBuildId;
  const bound = { declaration: null, review: null };
  const attempted = new Set();
  function url(path) {
    const u = new URL(path, ROOT);
    assert.equal(u.origin, ROOT, "Foreign API origin");
    assert.ok(
      !u.username && !u.password && !u.hash,
      "Unexpected URL components",
    );
    return u;
  }
  async function http(method, u, body) {
    const r = await request(u, {
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
    if (!r.ok) throw Error("Apple request failed: HTTP " + r.status);
    return r.status === 204 ? {} : await r.json();
  }
  async function get(path) {
    const u = url(path),
      p = u.pathname;
    const rules = new Map([
      ["/v1/builds/" + PRIOR_BUILD, { include: "app,preReleaseVersion,buildBetaDetail,betaAppReviewSubmission" }],
      ["/v1/apps/" + APP, {}],
      [
        base,
        {
          include:
            "app,preReleaseVersion,appEncryptionDeclaration,buildBetaDetail,betaAppReviewSubmission,betaGroups",
        },
      ],
      [base + "/preReleaseVersion", {}],
      [base + "/buildBetaDetail", {}],
      [base + "/betaBuildLocalizations", { collection: true }],
      ...GROUPS.flatMap((g) => [
        ["/v1/betaGroups/" + g.id, { include: "app" }],
        ["/v1/betaGroups/" + g.id + "/builds", { collection: true }],
      ]),
    ]);
    if (bound.declaration)
      rules.set("/v1/appEncryptionDeclarations/" + bound.declaration, {
        include: "app",
      });
    if (bound.review)
      rules.set("/v1/betaAppReviewSubmissions/" + bound.review, {
        include: "build",
      });
    const rule = rules.get(p);
    assert.ok(rule, "Foreign read");
    assert.equal(
      new Set(u.searchParams.keys()).size,
      [...u.searchParams.keys()].length,
      "Duplicate query",
    );
    for (const [key, value] of u.searchParams) {
      if (key === "include")
        assert.equal(value, rule.include, "Unexpected include");
      else if (key === "limit" && rule.collection)
        assert.match(value, /^(?:[1-9][0-9]?|1[0-9]{2}|200)$/);
      else if (key === "cursor" && rule.collection)
        assert.ok(value.length > 0 && value.length <= 2048);
      else throw Error("Unexpected query");
    }
    if (rule.include)
      assert.equal(
        u.searchParams.get("include"),
        rule.include,
        "Required relationships missing",
      );
    await journal({stage:"beta-read-started", path:p});
    const result = await http("GET", u);
    await journal({stage:"beta-read-returned", path:p,
      resourceType:Array.isArray(result.data) ? "collection" : result.data?.type,
      resourceId:Array.isArray(result.data) ? null : result.data?.id,
      relationshipNames:Object.keys(result.data?.relationships || {}),
      buildState:p === base + "/buildBetaDetail" ? result.data?.attributes : undefined,
      buildFlags:p === base ? {processingState:result.data?.attributes?.processingState,
        expired:result.data?.attributes?.expired,usesNonExemptEncryption:result.data?.attributes?.usesNonExemptEncryption} : undefined});
    if (p === base) {
      // Authorize related reads only from this exact build's own app-bound response.
      bound.declaration = null;
      bound.review = null;
      assert.equal(result.data?.type, "builds");
      assert.equal(result.data.id, upload.appleBuildId);
      assert.equal(result.data.relationships?.app?.data?.type, "apps");
      assert.equal(result.data.relationships?.app?.data?.id, APP);
      for (const [key, relation, type] of [
        [
          "declaration",
          "appEncryptionDeclaration",
          "appEncryptionDeclarations",
        ],
        ["review", "betaAppReviewSubmission", "betaAppReviewSubmissions"],
      ]) {
        const ref = result.data.relationships?.[relation]?.data;
        if (ref) {
          assert.equal(ref.type, type);
          assert.ok(validId(ref.id));
          bound[key] = ref.id;
        }
      }
    }
    return result;
  }
  async function write(method, path, body) {
    const u = url(path);
    assert.ok(
      ["POST", "PATCH"].includes(method) && !u.search,
      "Unexpected write method or query",
    );
    // A caller cannot supply its own approval plan: reread and recompute immediately.
    const plan = planDistribution(
      await readSnapshot(get, upload, now),
      upload,
      notes,
      now(),
    );
    const operation = plan.writes.find(
      (op) =>
        op.method === method &&
        op.path === u.pathname &&
        isDeepStrictEqual(op.body, body),
    );
    assert.ok(operation, "Write is not in the fresh exact-build plan");
    assert.ok(
      !attempted.has(operation.action),
      "Write already attempted; reconcile instead of retrying",
    );
    await journal({
      stage: "beta-http-started",
      app: APP,
      buildId: upload.appleBuildId,
      action: operation.action,
      method,
      path: u.pathname,
    });
    attempted.add(operation.action);
    const result = await http(method, u, structuredClone(operation.body));
    await journal({
      stage: "beta-http-returned",
      action: operation.action,
      resourceType: result.data?.type,
      resourceId: result.data?.id,
    });
    return result;
  }
  return { get, write };
}

import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { makeToken } from "./inspect-ios-store.mjs";
import {
  APP,
  BUILD,
  declarationPayload,
  applyDeclaration,
} from "./kilowallet-compliance-plan.mjs";
const ROOT = "https://api.appstoreconnect.apple.com";
export const ORIGINAL_GROUPS = Object.freeze([
  {
    id: "8f0948f4-86ef-4f7a-aa47-830a6e8f4eae",
    name: "Kilowallet Internal",
    internal: true,
  },
  {
    id: "f4f2520c-3eaf-46f9-a31a-a36d38b74c53",
    name: "Kilowallet Public Beta",
    internal: false,
  },
]);
export function clients(token, payload, journal, request = fetch) {
  const call = async (method, path, body) => {
    const u = new URL(path, ROOT);
    assert.equal(u.origin, ROOT);
    assert.ok(!u.username && !u.password);
    const declarations = u.pathname === "/v1/appEncryptionDeclarations";
    if (method === "GET") {
      assert.ok(
        u.pathname === "/v1/builds/" + BUILD ||
          (declarations && u.searchParams.get("filter[app]") === APP) ||
          ORIGINAL_GROUPS.some(
            (g) =>
              u.pathname === "/v1/betaGroups/" + g.id ||
              u.pathname === "/v1/betaGroups/" + g.id + "/builds",
          ),
        "Foreign read",
      );
    } else if (method === "POST") {
      assert.ok(declarations && !u.search, "Foreign create");
      assert.deepEqual(body, payload);
    } else if (method === "PATCH") {
      assert.equal(
        u.pathname,
        "/v1/builds/" + BUILD + "/relationships/appEncryptionDeclaration",
      );
      assert.ok(!u.search);
      assert.equal(body.data?.type, "appEncryptionDeclarations");
      assert.equal(typeof body.data?.id, "string");
      assert.ok(/^[A-Za-z0-9-]+$/.test(body.data.id));
      assert.deepEqual(Object.keys(body), ["data"]);
      assert.deepEqual(Object.keys(body.data).sort(), ["id", "type"]);
    } else throw Error("Unexpected method");
    if (method !== "GET")
      await journal({ stage: "http-write-started", method, path: u.pathname });
    const response = await request(u, {
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
    if (!response.ok)
      throw Error("Apple request failed: HTTP " + response.status);
    const result = response.status === 204 ? {} : await response.json();
    if (method !== "GET")
      await journal({
        stage: "http-write-response",
        method,
        status: response.status,
        resourceType: result.data?.type,
        resourceId: result.data?.id,
      });
    return result;
  };
  return {
    get: (path) => call("GET", path),
    write: (method, path, body) => call(method, path, body),
  };
}
function durableJournal(event) {
  const fd = openSync("kilowallet-compliance-journal.jsonl", "a", 0o600);
  try {
    writeSync(
      fd,
      JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n",
    );
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export async function inspectState(get) {
  const build = await get(
    "/v1/builds/" +
      BUILD +
      "?include=app,appEncryptionDeclaration,buildBetaDetail,betaGroups,betaAppReviewSubmission",
  );
  const declarations = await get(
    "/v1/appEncryptionDeclarations?filter%5Bapp%5D=" +
      APP +
      "&limit=200&include=app",
  );
  assert.ok(
    !declarations.links?.next && Array.isArray(declarations.data),
    "Incomplete declaration list",
  );
  assert.equal(build.data?.id, BUILD);
  assert.equal(build.data?.relationships?.app?.data?.id, APP);
  const related = (name, type, keys) => {
    const ref = build.data?.relationships?.[name]?.data;
    if (!ref) return null;
    assert.equal(ref.type, type);
    const matches = (build.included || []).filter(
      (x) => x.type === type && x.id === ref.id,
    );
    assert.equal(matches.length, 1, "Missing or duplicate included " + name);
    return {
      id: ref.id,
      type,
      attributes: Object.fromEntries(
        Object.entries(matches[0].attributes || {}).filter(([k]) =>
          keys.includes(k),
        ),
      ),
    };
  };
  const refs = build.data?.relationships?.betaGroups?.data;
  assert.ok(Array.isArray(refs), "Missing beta group membership");
  assert.ok(
    !build.data.relationships.betaGroups.links?.next,
    "Truncated beta groups",
  );
  assert.equal(new Set(refs.map((x) => x.id)).size, refs.length);
  const groups = refs.map((ref) => {
    assert.equal(ref.type, "betaGroups");
    const matches = (build.included || []).filter(
      (x) => x.type === ref.type && x.id === ref.id,
    );
    assert.equal(matches.length, 1, "Missing or duplicate included group");
    return {
      id: ref.id,
      name: matches[0].attributes?.name,
      isInternalGroup: matches[0].attributes?.isInternalGroup,
    };
  });
  const beta = {
    checkedAt: new Date().toISOString(),
    detail: related("buildBetaDetail", "buildBetaDetails", [
      "internalBuildState",
      "externalBuildState",
    ]),
    review: related("betaAppReviewSubmission", "betaAppReviewSubmissions", [
      "betaReviewState",
    ]),
    groups,
  };
  return {
    completed: true,
    readOnly: true,
    beta,
    build: {
      id: build.data?.id,
      attributes: Object.fromEntries(
        Object.entries(build.data?.attributes || {}).filter(([k]) =>
          [
            "version",
            "processingState",
            "expired",
            "usesNonExemptEncryption",
          ].includes(k),
        ),
      ),
      relationships: build.data?.relationships,
    },
    declarations: declarations.data.map((d) => ({
      id: d.id,
      type: d.type,
      attributes: Object.fromEntries(
        Object.entries(d.attributes || {}).filter(([k]) =>
          [
            "appDescription",
            "availableOnFrenchStore",
            "containsProprietaryCryptography",
            "containsThirdPartyCryptography",
            "exempt",
            "appEncryptionDeclarationState",
            "codeValue",
          ].includes(k),
        ),
      ),
      relationships: d.relationships,
    })),
  };
}
// Confirm membership from the group side as well as the build-side include.
// Apple documentation: GET /v1/betaGroups/{id}/builds.
export async function inspectOriginalGroups(get) {
  const out = [];
  for (const expected of ORIGINAL_GROUPS) {
    const base = "/v1/betaGroups/" + expected.id;
    const group = (await get(base + "?include=app")).data;
    assert.equal(group?.id, expected.id);
    assert.equal(group?.type, "betaGroups");
    assert.equal(group?.attributes?.name, expected.name);
    assert.equal(group?.attributes?.isInternalGroup, expected.internal);
    assert.equal(group?.relationships?.app?.data?.id, APP);
    let path = base + "/builds?limit=200";
    const pages = new Set(),
      ids = new Set();
    let complete = false;
    for (let page = 0; page < 5; page++) {
      assert.ok(!pages.has(path), "Cyclic group build pagination");
      pages.add(path);
      const body = await get(path);
      assert.ok(Array.isArray(body.data), "Missing group builds");
      for (const build of body.data) {
        assert.equal(build.type, "builds");
        assert.equal(typeof build.id, "string");
        assert.ok(!ids.has(build.id), "Duplicate group build");
        ids.add(build.id);
      }
      if (!body.links?.next) {
        if (body.meta?.paging?.total !== undefined)
          assert.equal(
            body.meta.paging.total,
            ids.size,
            "Incomplete group builds",
          );
        complete = true;
        break;
      }
      const next = new URL(body.links.next, ROOT);
      assert.equal(next.origin, ROOT);
      assert.ok(!next.username && !next.password);
      assert.equal(next.pathname, base + "/builds");
      path = next.pathname + next.search;
    }
    assert.ok(complete, "Incomplete group builds");
    out.push({
      id: expected.id,
      name: expected.name,
      isInternalGroup: expected.internal,
      assigned: ids.has(BUILD),
      complete: true,
    });
  }
  return out;
}
async function main() {
  let receipt = { app: APP, buildId: BUILD, completed: false };
  try {
    // These checks precede parsing or using Apple credentials.
    const policy = JSON.parse(
      readFileSync(
        ".github/release/KILOWALLET-040-COMPLIANCE-DRAFT-20261025.json",
      ),
    );
    const upload = JSON.parse(
      readFileSync("kilowallet-upload-qualification.json"),
    );
    const payload = declarationPayload(policy, upload);
    assert.equal(process.env.GITHUB_REF, "refs/heads/main");
    assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
    assert.equal(
      process.env.GITHUB_RUN_ATTEMPT,
      "1",
      "Retries require live-state reconciliation, never blind replay",
    );
    assert.equal(process.env.TEAM_ID, "PPG9C98EY9");
    const credential = JSON.parse(
      process.env.APP_STORE_CONNECT_API_KEY_CONTENT || "",
    );
    delete process.env.APP_STORE_CONNECT_API_KEY_CONTENT;
    const { get, write } = clients(
      makeToken(credential),
      payload,
      durableJournal,
    );
    assert.equal(
      process.env.KILOWALLET_COMPLIANCE_ACTION,
      "inspect",
      "This repair is read-only",
    );
    receipt = { ...receipt, ...(await inspectState(get)) };
    receipt.beta.originalGroups = await inspectOriginalGroups(get);
    receipt.beta.originalMembershipsVerified =
      receipt.beta.originalGroups.every((g) => g.assigned);
  } catch {
    receipt.error =
      "Compliance step stopped; inspect journal and live state before any further write";
    process.exitCode = 1;
  } finally {
    writeFileSync(
      "kilowallet-compliance-result.json",
      JSON.stringify(receipt, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(JSON.stringify(receipt, null, 2));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();

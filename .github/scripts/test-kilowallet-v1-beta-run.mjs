import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  execute,
  validateRuntime,
  durableJournal,
} from "./kilowallet-v1-beta-run.mjs";
const upload = {
  uploadVerified: true,
  currentNativeGatesVerified: true,
  app: "6824331953",
  marketingVersion: "1.0.0",
  signature: "verified",
  usesNonExemptEncryption: false,
  sourceCommit: "a".repeat(40),
  ipaSha256: "b".repeat(64),
  appleBuildId: "synthetic-build",
  build: "999",
  runId: 123,
  runAttempt: 1,
};
const environment = () => ({
  GITHUB_REPOSITORY: "romanmodin/RedWallet",
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_WORKFLOW_REF:
    "romanmodin/RedWallet/.github/workflows/kilowallet-v1-beta.yml@refs/heads/main",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_SHA: "c".repeat(40),
  GITHUB_RUN_ID: "456",
  TEAM_ID: "PPG9C98EY9",
  KILOWALLET_V1_BETA_ACTION: "inspect",
  APP_STORE_CONNECT_API_KEY_CONTENT: '{"synthetic":true}',
});
test("exact protected manual runtime permits inspect, read-only diagnosis or beta apply", () => {
  assert.equal(validateRuntime(environment(), upload).action, "inspect");
  assert.equal(validateRuntime({ ...environment(), KILOWALLET_V1_BETA_ACTION: "diagnose" }, upload).action, "diagnose");
  assert.equal(
    validateRuntime(
      { ...environment(), KILOWALLET_V1_BETA_ACTION: "apply" },
      upload,
    ).action,
    "apply",
  );
});
test("foreign repository, branch, workflow, retry, team or action stops before credential access", async () => {
  for (const [key, value] of Object.entries({
    GITHUB_REPOSITORY: "Kilombino/kilowallet-ios",
    GITHUB_REF: "refs/heads/feature",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_WORKFLOW_REF: "foreign",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_SHA: "bad",
    GITHUB_RUN_ID: "0",
    TEAM_ID: "foreign",
    KILOWALLET_V1_BETA_ACTION: "publish-store",
  })) {
    const env = { ...environment(), [key]: value };
    let reads = 0,
      tokens = 0;
    Object.defineProperty(env, "APP_STORE_CONNECT_API_KEY_CONTENT", {
      get() {
        reads++;
        throw Error("credential touched");
      },
      configurable: true,
    });
    await assert.rejects(
      execute(env, upload, "notes", { tokenFactory: () => tokens++ }),
    );
    assert.equal(reads, 0);
    assert.equal(tokens, 0);
  }
});
test("unqualified upload and empty notes cannot reach credentials", async () => {
  for (const [u, notes] of [
    [{ ...upload, currentNativeGatesVerified: false }, "notes"],
    [upload, ""],
  ]) {
    let reads = 0;
    const env = environment();
    Object.defineProperty(env, "APP_STORE_CONNECT_API_KEY_CONTENT", {
      get() {
        reads++;
        throw Error("credential touched");
      },
      configurable: true,
    });
    await assert.rejects(execute(env, u, notes));
    assert.equal(reads, 0);
  }
});
test("credential format failures are sanitized and credential environment is removed", async () => {
  const env = environment();
  env.APP_STORE_CONNECT_API_KEY_CONTENT = "secret-malformed-content";
  let tokens = 0;
  await assert.rejects(
    execute(env, upload, "notes", { tokenFactory: () => tokens++ }),
    /^Error: Apple API credential format is invalid$/,
  );
  assert.equal(tokens, 0);
  assert.equal(Object.hasOwn(env, "APP_STORE_CONNECT_API_KEY_CONTENT"), false);
});
test("read failure cannot yield a completed receipt or write, and credentials are removed", async () => {
  const env = environment();
  let writes = 0,
    tokens = 0;
  await assert.rejects(
    execute(env, upload, "notes", {
      tokenFactory: (c) => {
        assert.deepEqual(c, { synthetic: true });
        tokens++;
        return "token";
      },
      clientFactory: () => ({
        get: async () => {
          throw Error("synthetic read failure");
        },
        write: async () => writes++,
      }),
    }),
    /synthetic read failure/,
  );
  assert.equal(tokens, 1);
  assert.equal(writes, 0);
  assert.equal(Object.hasOwn(env, "APP_STORE_CONNECT_API_KEY_CONTENT"), false);
});
test("journal appends distinct durable synthetic events", () => {
  const dir = mkdtempSync(join(tmpdir(), "kilowallet-beta-journal-")),
    old = process.cwd();
  try {
    process.chdir(dir);
    durableJournal({ stage: "started", buildId: "synthetic" });
    durableJournal({ stage: "returned", buildId: "synthetic" });
    const events = readFileSync("kilowallet-v1-beta-journal.jsonl", "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.deepEqual(
      events.map((e) => e.stage),
      ["started", "returned"],
    );
    assert.ok(events.every((e) => Number.isFinite(Date.parse(e.at))));
  } finally {
    process.chdir(old);
    rmSync(dir, { recursive: true, force: true });
  }
});

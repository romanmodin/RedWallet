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
  validateUpload,
  planDistribution,
  applyDistribution,
} from "./kilowallet-v1-beta-plan.mjs";
import { readSnapshot } from "./kilowallet-v1-beta-snapshot.mjs";
import { clients } from "./kilowallet-v1-beta-client.mjs";
export function validateRuntime(env, upload) {
  validateUpload(upload);
  assert.equal(env.GITHUB_REPOSITORY, "romanmodin/RedWallet");
  assert.equal(env.GITHUB_REF, "refs/heads/main");
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(
    env.GITHUB_WORKFLOW_REF,
    "romanmodin/RedWallet/.github/workflows/kilowallet-v1-beta.yml@refs/heads/main",
  );
  assert.equal(
    env.GITHUB_RUN_ATTEMPT,
    "1",
    "A new attempt requires reconciliation, not blind replay",
  );
  assert.match(env.GITHUB_SHA, /^[0-9a-f]{40}$/);
  assert.match(env.GITHUB_RUN_ID, /^[1-9][0-9]*$/);
  assert.equal(env.TEAM_ID, "PPG9C98EY9");
  assert.ok(
    ["inspect", "apply"].includes(env.KILOWALLET_V1_BETA_ACTION),
    "Unexpected beta action",
  );
  return {
    action: env.KILOWALLET_V1_BETA_ACTION,
    coordinatorCommit: env.GITHUB_SHA,
    coordinatorRun: env.GITHUB_RUN_ID,
    coordinatorAttempt: 1,
  };
}
export function durableJournal(event) {
  const fd = openSync("kilowallet-v1-beta-journal.jsonl", "a", 0o600);
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
export async function execute(env, upload, notes, dependencies = {}) {
  // Validation precedes reading credentials; importing this module performs no action.
  const context = validateRuntime(env, upload);
  assert.equal(typeof notes, "string");
  assert.ok(notes.trim() && Buffer.byteLength(notes) <= 4000);
  const tokenFactory = dependencies.tokenFactory || makeToken;
  const clientFactory = dependencies.clientFactory || clients;
  const journal = dependencies.journal || durableJournal,
    now = dependencies.now || (() => Date.now());
  let credential;
  try {
    credential = JSON.parse(env.APP_STORE_CONNECT_API_KEY_CONTENT || "");
  } catch {
    throw Error("Apple API credential format is invalid");
  } finally {
    delete env.APP_STORE_CONNECT_API_KEY_CONTENT;
  }
  const token = tokenFactory(credential);
  credential = null;
  const client = clientFactory(
    token,
    upload,
    notes,
    journal,
    dependencies.request || fetch,
    now,
  );
  const read = async () => readSnapshot(client.get, upload, now);
  const plan =
    context.action === "apply"
      ? await applyDistribution(read, client.write, upload, notes, journal, now)
      : planDistribution(await read(), upload, notes, now());
  return {
    ...plan,
    ...context,
    observedAt: new Date(now()).toISOString(),
    complete: true,
    readOnly: context.action === "inspect",
    uploadRunId: upload.runId,
    uploadRunAttempt: upload.runAttempt,
  };
}
async function main() {
  let result = {
    app: APP,
    complete: false,
    readOnly: process.env.KILOWALLET_V1_BETA_ACTION === "inspect",
  };
  try {
    const upload = JSON.parse(
      readFileSync("kilowallet-upload-qualification.json", "utf8"),
    );
    const notes = readFileSync(
      ".github/release/kilowallet-v1-beta-notes.txt",
      "utf8",
    );
    result = await execute(process.env, upload, notes);
    console.log(
      JSON.stringify({
        app: APP,
        buildId: result.buildId,
        status: result.status,
        complete: result.complete,
        readOnly: result.readOnly,
      }),
    );
  } catch {
    // Never persist credential parser errors, raw responses, or request headers.
    result.error =
      "Qualification, protected runtime, or exact Apple beta verification failed; reconcile before retry.";
    console.error(result.error);
    process.exitCode = 1;
  } finally {
    delete process.env.APP_STORE_CONNECT_API_KEY_CONTENT;
    writeFileSync(
      "kilowallet-v1-beta-result.json",
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600 },
    );
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();

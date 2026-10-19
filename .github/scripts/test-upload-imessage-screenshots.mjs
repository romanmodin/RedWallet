import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  verifyImage,
  operation,
  existing,
  client,
  upload,
} from "./upload-imessage-screenshots.mjs";

test("rejects changed image bytes and dimensions", () => {
  const b = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(b);
  b.write("IHDR", 12);
  b.writeUInt32BE(1206, 16);
  b.writeUInt32BE(2622, 20);
  const expected = {
    sha256: createHash("sha256").update(b).digest("hex"),
    width: 1206,
    height: 2622,
  };
  assert.equal(
    verifyImage(b, expected),
    createHash("md5").update(b).digest("hex"),
  );
  assert.throws(
    () => verifyImage(Buffer.concat([b, Buffer.from("changed")]), expected),
    /hash mismatch/,
  );
  assert.throws(
    () => verifyImage(b, { ...expected, width: 2064 }),
    /dimension mismatch/,
  );
});
test("binary upload accepts only exact HTTPS Apple operations without API credentials", () => {
  const op = {
    url: "https://upload.itunes.apple.com/asset",
    method: "PUT",
    offset: 0,
    length: 24,
    requestHeaders: [{ name: "Content-Type", value: "image/png" }],
  };
  assert.deepEqual(operation(op, 24).headers, { "Content-Type": "image/png" });
  for (const url of [
    "http://upload.itunes.apple.com/asset",
    "https://apple.com.attacker.example/asset",
    "https://token@upload.itunes.apple.com/asset",
  ])
    assert.throws(() => operation({ ...op, url }, 24), /upload host/);
  assert.throws(
    () =>
      operation(
        { ...op, requestHeaders: [{ name: "Authorization", value: "secret" }] },
        24,
      ),
    /header/,
  );
  assert.throws(() => operation({ ...op, length: 25 }, 24), /byte range/);
});
test("reuse requires an unambiguous completed image with the exact checksum", () => {
  const image = {
    id: "image",
    attributes: {
      fileName: "reviewed.png",
      sourceFileChecksum: "hash",
      assetDeliveryState: { state: "COMPLETE" },
    },
  };
  assert.equal(existing([image], "reviewed.png", "hash"), image);
  assert.throws(
    () => existing([image], "reviewed.png", "different"),
    /identity mismatch/,
  );
  assert.throws(
    () => existing([image, image], "reviewed.png", "hash"),
    /Ambiguous/,
  );
  assert.throws(
    () =>
      existing(
        [
          {
            ...image,
            attributes: {
              ...image.attributes,
              assetDeliveryState: { state: "FAILED" },
            },
          },
        ],
        "reviewed.png",
        "hash",
      ),
    /processing review/,
  );
});
test("client cannot change builds, submit reviews, delete unreviewed assets, or follow arbitrary API paths", async () => {
  let calls = 0;
  const api = client("fake", async () => {
    calls++;
    return { ok: true, json: async () => ({ data: [] }) };
  });
  for (const [method, path] of [
    ["POST", "/v1/reviewSubmissions"],
    ["PATCH", "/v1/appStoreVersions/id/relationships/build"],
    ["DELETE", "/v1/appScreenshots/id"],
    ["GET", "https://example.com"],
    ["GET", "/v1/apps/1"],
  ])
    await assert.rejects(api(method, path), /Unexpected/);
  assert.equal(calls, 0);
});
test("wrong app identity stops before any Apple mutation", async () => {
  const calls = [];
  const api = async (method, path) => {
    calls.push(method);
    return { data: { id: "different", attributes: { bundleId: "other" } } };
  };
  await assert.rejects(upload(api, []), /Wrong Apple app/);
  assert.deepEqual(calls, ["GET"]);
});

test("failed screenshot cleanup requires its exact observed checksum, rejection code and a completed replacement", async () => {
  const { retireRejected, REJECTED_ID } = await import(
    "./upload-imessage-screenshots.mjs"
  );
  let removed = false;
  const old = {
    id: REJECTED_ID,
    attributes: {
      sourceFileChecksum: "259aeed4ed85d52aaa888fb0b55f4747",
      assetDeliveryState: {
        state: "FAILED",
        errors: [{ code: "SPEC_MISMATCH" }],
      },
    },
  };
  let shots = [old];
  const api = async (method, path) => {
    if (method === "DELETE") {
      assert.equal(path, "/v1/appScreenshots/" + REJECTED_ID);
      removed = true;
      shots = shots.filter((x) => x.id !== REJECTED_ID);
      return {};
    }
    if (path.endsWith("/appScreenshotSets"))
      return {
        data: [
          {
            id: "set",
            attributes: { screenshotDisplayType: "IMESSAGE_APP_IPHONE_67" },
          },
        ],
      };
    return { data: shots };
  };
  await assert.rejects(retireRejected(api), /not complete/);
  assert.equal(removed, false);
  shots.push({
    id: "replacement",
    attributes: { assetDeliveryState: { state: "COMPLETE" } },
  });
  old.attributes.sourceFileChecksum = "different";
  await assert.rejects(retireRejected(api), /changed/);
  assert.equal(removed, false);
  old.attributes.sourceFileChecksum = "259aeed4ed85d52aaa888fb0b55f4747";
  assert.equal(await retireRejected(api), true);
  assert.equal(removed, true);
  assert.equal(await retireRejected(api), false);
});

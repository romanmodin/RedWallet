import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  OLD,
  inventory,
  retireOld,
  storeClient,
} from "./upload-store-screenshots.mjs";
function fixture() {
  const data = {},
    images = [],
    writes = [];
  data[
    "/v1/appStoreVersionLocalizations/67c79fa3-be47-4fc0-94c5-713836f9d262/appScreenshotSets"
  ] = { data: [] };
  data["/v1/appStoreVersions/65cd6bc4-9962-4b77-a3ca-78c115f3a615"] = {
    data: { attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" } },
  };
  for (const [displayType, old] of Object.entries(OLD)) {
    const setId = displayType.replaceAll("_", "-");
    data[
      "/v1/appStoreVersionLocalizations/67c79fa3-be47-4fc0-94c5-713836f9d262/appScreenshotSets"
    ].data.push({
      id: setId,
      attributes: { screenshotDisplayType: displayType },
    });
    const shots = old.map((id) => ({
      id,
      attributes: { assetDeliveryState: { state: "COMPLETE" } },
    }));
    for (let i = 0; i < 4; i++) {
      const bytes = Buffer.alloc(33);
      Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
      bytes.write("IHDR", 12);
      bytes.writeUInt32BE(2, 16);
      bytes.writeUInt32BE(3, 20);
      bytes.write(displayType.slice(-3) + i, 24);
      const checksum = createHash("md5").update(bytes).digest("hex");
      images.push({
        displayType,
        file: setId + i + ".png",
        bytes,
        width: 2,
        height: 3,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      shots.push({
        id: setId + "-" + i,
        attributes: {
          sourceFileChecksum: checksum,
          assetDeliveryState: { state: "COMPLETE" },
        },
      });
    }
    data["/v1/appScreenshotSets/" + setId + "/appScreenshots"] = {
      data: shots,
    };
  }
  const api = async (method, path) => {
    if (method === "DELETE") {
      writes.push(path);
      for (const v of Object.values(data))
        if (Array.isArray(v.data))
          v.data = v.data.filter((s) => "/v1/appScreenshots/" + s.id !== path);
      return null;
    }
    assert.equal(method, "GET");
    assert.ok(data[path], path);
    return structuredClone(data[path]);
  };
  return { data, images, writes, api };
}
test("a failed replacement in either family prevents every deletion", async () => {
  const f = fixture();
  const list =
    f.data["/v1/appScreenshotSets/APP-IPAD-PRO-3GEN-129/appScreenshots"].data;
  list.at(-1).attributes.assetDeliveryState.state = "FAILED";
  await assert.rejects(retireOld(f.api, f.images, {}), /not complete/);
  assert.equal(f.writes.length, 0);
});
test("unrecognized existing screenshots stop before mutation", async () => {
  const f = fixture();
  f.data["/v1/appScreenshotSets/APP-IPHONE-67/appScreenshots"].data.push({
    id: "someone-elses-image",
    attributes: {},
  });
  await assert.rejects(inventory(f.api, f.images, false), /Unrecognized/);
  assert.equal(f.writes.length, 0);
});
test("only retires the eight observed old assets after both families are complete; repeated inspection needs no writes", async () => {
  const f = fixture(),
    report = {};
  await retireOld(f.api, f.images, report);
  assert.deepEqual(
    f.writes.sort(),
    Object.values(OLD)
      .flat()
      .map((id) => "/v1/appScreenshots/" + id)
      .sort(),
  );
  assert.equal(report.families.length, 2);
  assert.ok(report.families.every((s) => s.ids.length === 4));
  f.writes.length = 0;
  await retireOld(f.api, f.images, {});
  assert.equal(f.writes.length, 0);
});
test("the HTTP client refuses deletion of any unobserved resource", async () => {
  let calls = 0;
  const api = storeClient("fake", async () => {
    calls++;
    return { status: 204 };
  });
  await assert.rejects(
    api("DELETE", "/v1/appScreenshots/unknown"),
    /Unexpected/,
  );
  await assert.rejects(api("POST", "/v1/reviewSubmissions", {}), /Unexpected/);
  assert.equal(calls, 0);
  await api("DELETE", "/v1/appScreenshots/" + Object.values(OLD)[0][0]);
  assert.equal(calls, 1);
});

test("retains an existing asset when its bytes exactly match a reviewed replacement", async () => {
  const f = fixture();
  const shots =
    f.data["/v1/appScreenshotSets/APP-IPHONE-67/appScreenshots"].data;
  const retainedId = OLD.APP_IPHONE_67[0];
  shots[4].id = retainedId;
  shots.shift();
  const report = {};
  await retireOld(f.api, f.images, report);
  assert.equal(f.writes.length, 7);
  assert.equal(f.writes.includes("/v1/appScreenshots/" + retainedId), false);
  assert.ok(
    report.families
      .find((s) => s.displayType === "APP_IPHONE_67")
      .ids.includes(retainedId),
  );
});

import { element } from "detox";
import { dismissAlertByText } from "../e2e/helperz";

jest.mock("detox", () => ({ element: jest.fn() }));

const savedGlobals = {
  device: global.device,
  by: global.by,
  waitFor: global.waitFor,
};
let tap;
let visible;
let indexed;
beforeEach(() => {
  tap = jest.fn().mockResolvedValue(undefined);
  visible = jest.fn().mockResolvedValue(undefined);
  indexed = jest.fn(() => {
    throw new Error("Indexed activity root used");
  });
  global.device = { getPlatform: () => "android" };
  global.by = { text: (value) => value };
  element.mockReturnValue({ tap, atIndex: indexed });
  global.waitFor = () => ({ toBeVisible: () => ({ withTimeout: visible }) });
});
afterEach(() => {
  Object.assign(global, savedGlobals);
  jest.clearAllMocks();
});
test("waits for the native Android dialog and taps its unindexed button once", async () => {
  expect(await dismissAlertByText("Yes, delete", 1000)).toBe(true);
  expect(visible).toHaveBeenCalledWith(1000);
  expect(tap).toHaveBeenCalledTimes(1);
  expect(indexed).not.toHaveBeenCalled();
});
test("does not tap when the confirmation never appears", async () => {
  visible.mockRejectedValue(new Error("No dialog"));
  expect(await dismissAlertByText("Yes, delete", 1000)).toBe(false);
  expect(tap).not.toHaveBeenCalled();
});
test("does not retry an uncertain confirmation tap", async () => {
  tap.mockRejectedValue(new Error("Lost window focus"));
  await expect(dismissAlertByText("Yes, delete")).rejects.toThrow(
    "Lost window focus",
  );
  expect(tap).toHaveBeenCalledTimes(1);
});

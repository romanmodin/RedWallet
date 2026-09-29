import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirstLaunchSplash } from "./FirstLaunchSplash";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const mount = () =>
  render(
    <FirstLaunchSplash>
      <p>Wallet contents</p>
    </FirstLaunchSplash>,
  );
describe("first launch introduction", () => {
  it("shows once and persists across remounts after continuing", () => {
    const view = mount();
    expect(screen.queryByText("Wallet contents")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to RedWallet" }),
    );
    expect(screen.getByText("Wallet contents")).toBeTruthy();
    view.unmount();
    mount();
    expect(screen.queryByLabelText("XBT BLAKE2B introduction")).toBeNull();
  });
  it("finishes when the video ends", () => {
    mount();
    fireEvent.ended(screen.getByLabelText("XBT BLAKE2B introduction"));
    expect(screen.getByText("Wallet contents")).toBeTruthy();
  });
  it("does not block the wallet when media fails", () => {
    mount();
    fireEvent.error(screen.getByLabelText("XBT BLAKE2B introduction"));
    expect(screen.getByText("Wallet contents")).toBeTruthy();
  });
  it("skips the intro if browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    mount();
    expect(screen.getByText("Wallet contents")).toBeTruthy();
  });
});

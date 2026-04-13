import { describe, expect, it } from "vitest";
import { parseBrowserTargets, parseCaptureMode, parsePositiveInteger } from "../src/cli/options.js";

describe("parseBrowserTargets", () => {
  it("parses one exact browser version", () => {
    expect(parseBrowserTargets("chrome:128.0")).toEqual([
      { browserName: "chrome", browserVersion: "128.0" },
    ]);
  });

  it("parses multiple browsers and trims whitespace", () => {
    expect(parseBrowserTargets("chrome:128.0, firefox:130.0 , chrome:127")).toEqual([
      { browserName: "chrome", browserVersion: "128.0" },
      { browserName: "firefox", browserVersion: "130.0" },
      { browserName: "chrome", browserVersion: "127" },
    ]);
  });

  it("uses an empty version to let Selenoid choose the configured default", () => {
    expect(parseBrowserTargets("chrome")).toEqual([
      { browserName: "chrome", browserVersion: "" },
    ]);
  });

  it("rejects empty browser entries", () => {
    expect(() => parseBrowserTargets("chrome:128.0,")).toThrow("empty browser entry");
  });

  it("rejects malformed browser entries", () => {
    expect(() => parseBrowserTargets("chrome:128.0:extra")).toThrow("Invalid browser entry");
  });

  it("rejects missing browser names", () => {
    expect(() => parseBrowserTargets(":128.0")).toThrow("Invalid browser entry");
  });
});

describe("parseCaptureMode", () => {
  it("accepts supported run-level capture modes", () => {
    expect(parseCaptureMode("all")).toBe("all");
    expect(parseCaptureMode("failure")).toBe("failure");
    expect(parseCaptureMode("off")).toBe("off");
  });

  it("rejects unsupported capture modes", () => {
    expect(() => parseCaptureMode("always")).toThrow("Invalid capture mode");
  });
});

describe("parsePositiveInteger", () => {
  it("parses positive integers", () => {
    expect(parsePositiveInteger("5", "concurrency")).toBe(5);
  });

  it("rejects zero and decimals", () => {
    expect(() => parsePositiveInteger("0", "concurrency")).toThrow("Invalid concurrency");
    expect(() => parsePositiveInteger("1.5", "concurrency")).toThrow("Invalid concurrency");
  });
});

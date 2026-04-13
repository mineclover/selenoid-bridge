import { describe, expect, it } from "vitest";
import { runWithConcurrency, shouldCaptureStep } from "../src/runner/runner.js";

describe("runWithConcurrency", () => {
  it("limits active work and preserves result order", async () => {
    let active = 0;
    let maxActive = 0;

    const results = await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return item * 10;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it("uses at least one worker for invalid concurrency", async () => {
    const results = await runWithConcurrency([1, 2], 0, async (item) => item);

    expect(results).toEqual([1, 2]);
  });
});

describe("shouldCaptureStep", () => {
  it("lets the run command force all captures even when the template prefers failures", () => {
    const step = { action: "goto" as const, url: "/", capture: "failure" as const };

    expect(shouldCaptureStep(step, "passed", "all")).toBe(true);
  });

  it("lets the run command disable captures even when the template prefers always", () => {
    const step = { action: "goto" as const, url: "/", capture: "always" as const };

    expect(shouldCaptureStep(step, "failed", "off")).toBe(false);
  });

  it("uses step capture policy when the run command keeps the failure default", () => {
    const step = { action: "goto" as const, url: "/", capture: "always" as const };

    expect(shouldCaptureStep(step, "passed", "failure")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { toHtmlReport, toJsonReport } from "../src/runner/report.js";
import type { RunResult } from "../src/scenario/types.js";

describe("report generation", () => {
  it("includes step captures and metadata in html report", () => {
    const results: RunResult[] = [
      {
        browser: { browserName: "chrome", browserVersion: "128.0" },
        scenario: "Checkout",
        status: "failed",
        duration: 1234,
        startedAt: "2026-03-27T00:00:00.000Z",
        finishedAt: "2026-03-27T00:00:01.234Z",
        artifactsDir: "/tmp/artifacts/chrome-128-0",
        steps: [
          {
            index: 0,
            status: "failed",
            duration: 321,
            error: "Button not found",
            step: {
              id: "payment-submit",
              phase: "결제 진행 확인",
              name: "결제를 진행한다",
              action: "click",
              selector: { css: "[data-testid='payment-submit']", strategy: "data-testid" },
              capture: "always",
            },
            artifacts: {
              pageUrl: "https://shop.example.com/checkout",
              pageTitle: "Checkout",
              screenshotPath: "chrome-128-0/01-payment-submit-failed.png",
            },
          },
        ],
      },
    ];

    const html = toHtmlReport(results);

    expect(html).toContain("결제 진행 확인");
    expect(html).toContain("chrome-128-0/01-payment-submit-failed.png");
    expect(html).toContain("Button not found");
  });

  it("includes summary in json report", () => {
    const results: RunResult[] = [
      {
        browser: { browserName: "chrome", browserVersion: "128.0" },
        scenario: "Smoke",
        status: "passed",
        duration: 100,
        startedAt: "2026-03-27T00:00:00.000Z",
        finishedAt: "2026-03-27T00:00:00.100Z",
        steps: [],
      },
    ];

    const json = JSON.parse(toJsonReport(results)) as { summary: { passedRuns: number; totalRuns: number } };

    expect(json.summary.totalRuns).toBe(1);
    expect(json.summary.passedRuns).toBe(1);
  });

  it("escapes html in user-provided report fields", () => {
    const results: RunResult[] = [
      {
        browser: { browserName: "chrome", browserVersion: "128.0" },
        scenario: "<script>alert(1)</script>",
        status: "failed",
        duration: 100,
        startedAt: "2026-03-27T00:00:00.000Z",
        finishedAt: "2026-03-27T00:00:00.100Z",
        steps: [
          {
            index: 0,
            status: "failed",
            duration: 10,
            error: "<img src=x onerror=alert(1)>",
            step: {
              action: "assert",
              type: "title",
              expected: "<Home>",
              name: "<b>Title check</b>",
            },
          },
        ],
      },
    ];

    const html = toHtmlReport(results);

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<b>Title check</b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

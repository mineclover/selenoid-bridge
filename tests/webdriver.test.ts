import { afterEach, describe, expect, it, vi } from "vitest";
import { WebDriverClient } from "../src/runner/webdriver.js";

describe("WebDriverClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the requested browser version when provided", async () => {
    const requests: Array<{ body?: string }> = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      requests.push({ body: init?.body?.toString() });
      return new Response(JSON.stringify({ value: { sessionId: "session-1" } }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = new WebDriverClient("http://selenoid.example");
    await client.createSession({ browserName: "chrome", browserVersion: "128.0" });

    const body = JSON.parse(requests[0].body || "{}") as {
      capabilities: { alwaysMatch: Record<string, string> };
    };
    expect(body.capabilities.alwaysMatch).toEqual({
      browserName: "chrome",
      browserVersion: "128.0",
    });
  });

  it("omits browserVersion when the runner wants Selenoid default version", async () => {
    const requests: Array<{ body?: string }> = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      requests.push({ body: init?.body?.toString() });
      return new Response(JSON.stringify({ value: { sessionId: "session-1" } }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = new WebDriverClient("http://selenoid.example");
    await client.createSession({ browserName: "chrome", browserVersion: "" });

    const body = JSON.parse(requests[0].body || "{}") as {
      capabilities: { alwaysMatch: Record<string, string> };
    };
    expect(body.capabilities.alwaysMatch).toEqual({
      browserName: "chrome",
    });
  });
});

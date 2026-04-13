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

  it("hovers by moving the mouse pointer to the element", async () => {
    const requests: Array<{ url: string; method?: string; body?: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method, body: init?.body?.toString() });
      if (url.endsWith("/session")) {
        return jsonResponse({ value: { sessionId: "session-1" } });
      }
      if (url.endsWith("/element")) {
        return jsonResponse({ value: { "element-6066-11e4-a52e-4f735466cecf": "element-1" } });
      }
      return jsonResponse({ value: null });
    });

    const client = new WebDriverClient("http://selenoid.example");
    await client.createSession({ browserName: "chrome", browserVersion: "128.0" });
    await client.hover({ css: "#menu", strategy: "id" });

    const actionsRequest = requests.find((request) => request.url.endsWith("/actions"));
    expect(actionsRequest?.method).toBe("POST");
    expect(JSON.parse(actionsRequest?.body || "{}")).toEqual({
      actions: [{
        type: "pointer",
        id: "mouse",
        parameters: { pointerType: "mouse" },
        actions: [{
          type: "pointerMove",
          duration: 100,
          origin: { "element-6066-11e4-a52e-4f735466cecf": "element-1" },
          x: 0,
          y: 0,
        }],
      }],
    });
  });

  it("checks an unchecked element without toggling an already selected element", async () => {
    const requests: Array<{ url: string; method?: string; body?: string }> = [];
    let selected = false;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method, body: init?.body?.toString() });
      if (url.endsWith("/session")) {
        return jsonResponse({ value: { sessionId: "session-1" } });
      }
      if (url.endsWith("/element")) {
        return jsonResponse({ value: { "element-6066-11e4-a52e-4f735466cecf": "checkbox-1" } });
      }
      if (url.endsWith("/selected")) {
        return jsonResponse({ value: selected });
      }
      if (url.endsWith("/click")) {
        selected = true;
      }
      return jsonResponse({ value: null });
    });

    const client = new WebDriverClient("http://selenoid.example");
    await client.createSession({ browserName: "chrome", browserVersion: "128.0" });
    await client.check({ css: "#terms", strategy: "id" });
    await client.check({ css: "#terms", strategy: "id" });

    expect(requests.filter((request) => request.url.endsWith("/click"))).toHaveLength(1);
  });

  it("returns false for missing elements but rethrows infrastructure display errors", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/session")) {
        return jsonResponse({ value: { sessionId: "session-1" } });
      }
      if (url.endsWith("/element")) {
        return new Response(JSON.stringify({ value: { error: "no such element", message: "no such element" } }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return jsonResponse({ value: null });
    });

    const client = new WebDriverClient("http://selenoid.example");
    await client.createSession({ browserName: "chrome", browserVersion: "128.0" });

    expect(await client.isDisplayed({ css: "#missing", strategy: "id" })).toBe(false);

    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/session")) {
        return jsonResponse({ value: { sessionId: "session-1" } });
      }
      if (url.endsWith("/element")) {
        return new Response(JSON.stringify({ value: { error: "unknown error", message: "browser crashed" } }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return jsonResponse({ value: null });
    });

    await expect(client.isDisplayed({ css: "#unstable", strategy: "id" })).rejects.toThrow("browser crashed");
  });

  it("escapes select option values before building the option selector", async () => {
    const requests: Array<{ url: string; method?: string; body?: string }> = [];
    let elementRequestCount = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method, body: init?.body?.toString() });
      if (url.endsWith("/session")) {
        return jsonResponse({ value: { sessionId: "session-1" } });
      }
      if (url.endsWith("/element")) {
        elementRequestCount += 1;
        return jsonResponse({
          value: {
            "element-6066-11e4-a52e-4f735466cecf": elementRequestCount === 1 ? "select-1" : "option-1",
          },
        });
      }
      return jsonResponse({ value: null });
    });

    const client = new WebDriverClient("http://selenoid.example");
    await client.createSession({ browserName: "chrome", browserVersion: "128.0" });
    await client.select({ css: "#country", strategy: "id" }, 'us\\west"1');

    const optionLookupBody = JSON.parse(requests.filter((request) => request.url.endsWith("/element"))[1].body || "{}");
    expect(optionLookupBody).toEqual({
      using: "css selector",
      value: 'option[value="us\\\\west\\"1"]',
    });
  });

  it("scrolls to an element and then applies directional page scroll", async () => {
    const requests: Array<{ url: string; method?: string; body?: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method, body: init?.body?.toString() });
      if (url.endsWith("/session")) {
        return jsonResponse({ value: { sessionId: "session-1" } });
      }
      if (url.endsWith("/element")) {
        return jsonResponse({ value: { "element-6066-11e4-a52e-4f735466cecf": "section-1" } });
      }
      return jsonResponse({ value: null });
    });

    const client = new WebDriverClient("http://selenoid.example");
    await client.createSession({ browserName: "chrome", browserVersion: "128.0" });
    await client.scrollTo({ css: "#pricing", strategy: "id" });
    await client.scrollBy("up", 250);

    const executeRequests = requests.filter((request) => request.url.endsWith("/execute/sync"));
    expect(executeRequests).toHaveLength(2);
    expect(JSON.parse(executeRequests[0].body || "{}")).toEqual({
      script: "arguments[0].scrollIntoView({ block: 'center', inline: 'center' });",
      args: [{ "element-6066-11e4-a52e-4f735466cecf": "section-1" }],
    });
    expect(JSON.parse(executeRequests[1].body || "{}")).toEqual({
      script: "window.scrollBy(0, arguments[0]);",
      args: [-250],
    });
  });
});

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}

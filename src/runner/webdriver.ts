import type { Selector, BrowserTarget } from "../scenario/types.js";

export interface WebDriverClientOptions {
  requestTimeoutMs?: number;
}

export class WebDriverClient {
  private baseUrl: string;
  private requestTimeoutMs: number;
  private sessionId: string | null = null;

  constructor(selenoidUrl: string, options: WebDriverClientOptions = {}) {
    this.baseUrl = selenoidUrl.replace(/\/$/, "");
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30000;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const controller = this.requestTimeoutMs > 0 ? new AbortController() : undefined;
    const timeout = controller
      ? setTimeout(() => controller.abort(), this.requestTimeoutMs)
      : undefined;

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: controller?.signal,
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error(`WebDriver request timed out after ${this.requestTimeoutMs}ms: ${method} ${path}`);
      }
      throw e;
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    const data = await res.json() as { value: unknown };

    if (res.status >= 400) {
      const errorValue = data.value as Record<string, unknown> | undefined;
      const msg = errorValue?.message || errorValue?.error || JSON.stringify(data);
      throw new Error(`WebDriver error: ${msg}`);
    }

    return data.value;
  }

  async createSession(browser: BrowserTarget): Promise<string> {
    const alwaysMatch: Record<string, string> = {
      browserName: browser.browserName,
    };
    if (browser.browserVersion) {
      alwaysMatch.browserVersion = browser.browserVersion;
    }

    const result = await this.request("POST", "/wd/hub/session", {
      capabilities: {
        alwaysMatch,
      },
    }) as { sessionId: string };

    this.sessionId = result.sessionId;
    return this.sessionId;
  }

  async deleteSession(): Promise<void> {
    if (!this.sessionId) return;
    await this.request("DELETE", `/wd/hub/session/${this.sessionId}`);
    this.sessionId = null;
  }

  async navigate(url: string): Promise<void> {
    await this.request("POST", `/wd/hub/session/${this.sessionId}/url`, { url });
  }

  async findElement(selector: Selector): Promise<string> {
    let using: string;
    let value: string;

    if (selector.xpath && (!selector.css || selector.strategy === "text" || selector.strategy === "role-name")) {
      using = "xpath";
      value = selector.xpath;
    } else {
      using = "css selector";
      value = selector.css;
    }

    const result = await this.request("POST", `/wd/hub/session/${this.sessionId}/element`, {
      using,
      value,
    }) as Record<string, string>;

    // W3C WebDriver returns element ID in a key like "element-6066-..."
    const elementId = Object.values(result)[0];
    if (!elementId) throw new Error(`Element not found: ${value}`);
    return elementId;
  }

  async click(selector: Selector): Promise<void> {
    const elementId = await this.findElement(selector);
    await this.request("POST", `/wd/hub/session/${this.sessionId}/element/${elementId}/click`);
  }

  async fill(selector: Selector, text: string): Promise<void> {
    const elementId = await this.findElement(selector);
    // Clear existing value
    await this.request("POST", `/wd/hub/session/${this.sessionId}/element/${elementId}/clear`);
    // Type new value
    await this.request("POST", `/wd/hub/session/${this.sessionId}/element/${elementId}/value`, {
      text,
    });
  }

  async select(selector: Selector, value: string): Promise<void> {
    // Click the select element, then find and click the option
    const elementId = await this.findElement(selector);
    await this.request("POST", `/wd/hub/session/${this.sessionId}/element/${elementId}/click`);
    const optionId = await this.findElement({ css: `option[value='${value}']`, strategy: "css-path" });
    await this.request("POST", `/wd/hub/session/${this.sessionId}/element/${optionId}/click`);
  }

  async isDisplayed(selector: Selector): Promise<boolean> {
    try {
      const elementId = await this.findElement(selector);
      const result = await this.request("GET", `/wd/hub/session/${this.sessionId}/element/${elementId}/displayed`);
      return result === true;
    } catch {
      return false;
    }
  }

  async getText(selector: Selector): Promise<string> {
    const elementId = await this.findElement(selector);
    return (await this.request("GET", `/wd/hub/session/${this.sessionId}/element/${elementId}/text`)) as string;
  }

  async getValue(selector: Selector): Promise<string> {
    const elementId = await this.findElement(selector);
    return (await this.request("GET", `/wd/hub/session/${this.sessionId}/element/${elementId}/property/value`)) as string;
  }

  async getTitle(): Promise<string> {
    return (await this.request("GET", `/wd/hub/session/${this.sessionId}/title`)) as string;
  }

  async getUrl(): Promise<string> {
    return (await this.request("GET", `/wd/hub/session/${this.sessionId}/url`)) as string;
  }

  async takeScreenshot(): Promise<Buffer> {
    const base64 = (await this.request("GET", `/wd/hub/session/${this.sessionId}/screenshot`)) as string;
    return Buffer.from(base64, "base64");
  }

  async pressKey(key: string): Promise<void> {
    await this.request("POST", `/wd/hub/session/${this.sessionId}/actions`, {
      actions: [{
        type: "key",
        id: "keyboard",
        actions: [
          { type: "keyDown", value: mapKey(key) },
          { type: "keyUp", value: mapKey(key) },
        ],
      }],
    });
  }
}

function mapKey(key: string): string {
  const keyMap: Record<string, string> = {
    Enter: "\uE007",
    Tab: "\uE004",
    Escape: "\uE00C",
    Backspace: "\uE003",
    Delete: "\uE017",
    ArrowUp: "\uE013",
    ArrowDown: "\uE015",
    ArrowLeft: "\uE012",
    ArrowRight: "\uE014",
  };
  return keyMap[key] || key;
}

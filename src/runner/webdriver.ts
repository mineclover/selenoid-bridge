import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { deflateRawSync } from "node:zlib";
import type { Selector, BrowserTarget } from "../scenario/types.js";

export interface WebDriverClientOptions {
  requestTimeoutMs?: number;
}

export class WebDriverError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode?: string,
  ) {
    super(message);
    this.name = "WebDriverError";
  }
}

export class WebDriverClient {
  private baseUrl: string;
  private requestTimeoutMs: number;
  private sessionId: string | null = null;
  private readonly w3cElementKey = "element-6066-11e4-a52e-4f735466cecf";

  constructor(selenoidUrl: string, options: WebDriverClientOptions = {}) {
    this.baseUrl = selenoidUrl.replace(/\/$/, "");
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30000;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const retryDelays = [300, 900, 2700];
    const retryableStatus = new Set([502, 503, 504]);

    for (let attempt = 0; ; attempt++) {
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
        if (attempt < retryDelays.length) {
          await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
          continue;
        }
        throw e;
      } finally {
        if (timeout) clearTimeout(timeout);
      }

      if (retryableStatus.has(res.status) && attempt < retryDelays.length) {
        await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
        continue;
      }

      const data = await res.json() as { value: unknown };

      if (res.status >= 400) {
        const errorValue = data.value as Record<string, unknown> | undefined;
        const msg = errorValue?.message || errorValue?.error || JSON.stringify(data);
        const errorCode = typeof errorValue?.error === "string" ? errorValue.error : undefined;
        throw new WebDriverError(`WebDriver error: ${msg}`, res.status, errorCode);
      }

      return data.value;
    }
  }

  async createSession(
    browser: BrowserTarget,
    selenoidOptions?: Record<string, unknown>,
    stealth: boolean = true,
    extensions?: string[],
  ): Promise<{ sessionId: string; cdpUrl?: string }> {
    const alwaysMatch: Record<string, unknown> = {
      browserName: browser.browserName,
    };
    if (browser.browserVersion) {
      alwaysMatch.browserVersion = browser.browserVersion;
    }
    if (selenoidOptions) {
      alwaysMatch["selenoid:options"] = selenoidOptions;
    }

    if (browser.browserName === "chrome") {
      const args = [
        "--disable-blink-features=AutomationControlled",
        "--lang=ko-KR",
        "--window-size=1366,768",
      ];
      if (extensions && extensions.length > 0) {
        args.push(`--load-extension=${extensions.join(",")}`);
      }
      if (stealth) {
        alwaysMatch["goog:chromeOptions"] = {
          args,
          excludeSwitches: ["enable-automation"],
          useAutomationExtension: false,
          prefs: {
            "intl.accept_languages": "ko-KR,ko,en-US,en",
            "credentials_enable_service": false,
            "profile.password_manager_enabled": false,
          },
        };
      } else if (extensions && extensions.length > 0) {
        alwaysMatch["goog:chromeOptions"] = { args };
      }
    }

    const result = await this.request("POST", "/wd/hub/session", {
      capabilities: { alwaysMatch },
    }) as { sessionId: string; capabilities?: Record<string, unknown> };

    this.sessionId = result.sessionId;
    const cdpUrl = result.capabilities?.["se:cdp"] as string | undefined;

    if (stealth && browser.browserName === "chrome") {
      await this.applyStealth().catch((e: unknown) => console.warn("[stealth] CDP injection failed:", e instanceof Error ? e.message : String(e)));
    }

    return { sessionId: this.sessionId, cdpUrl };
  }

  private async applyStealth(): Promise<void> {
    await this.sendCdpCommand("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR','ko','en-US','en'] });
        Object.defineProperty(navigator, 'plugins',   { get: () => [1,2,3,4,5] });
        if (!window.chrome) window.chrome = {};
        if (!window.chrome.runtime) window.chrome.runtime = {};
        const _origQuery = navigator.permissions && navigator.permissions.query;
        if (_origQuery) {
          navigator.permissions.query = (p) =>
            p && p.name === 'notifications'
              ? Promise.resolve({ state: Notification.permission })
              : _origQuery.call(navigator.permissions, p);
        }
      `,
    });
    await this.sendCdpCommand("Network.setUserAgentOverride", {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      acceptLanguage: "ko-KR,ko;q=0.9,en;q=0.8",
      platform: "MacIntel",
    });
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

  async doubleClick(selector: Selector): Promise<void> {
    const elementId = await this.findElement(selector);
    await this.request("POST", `/wd/hub/session/${this.sessionId}/actions`, {
      actions: [{
        type: "pointer", id: "mouse", parameters: { pointerType: "mouse" },
        actions: [
          { type: "pointerMove", duration: 0, origin: this.elementReference(elementId), x: 0, y: 0 },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp",   button: 0 },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp",   button: 0 },
        ],
      }],
    });
  }

  async rightClick(selector: Selector): Promise<void> {
    const elementId = await this.findElement(selector);
    await this.request("POST", `/wd/hub/session/${this.sessionId}/actions`, {
      actions: [{
        type: "pointer", id: "mouse", parameters: { pointerType: "mouse" },
        actions: [
          { type: "pointerMove", duration: 0, origin: this.elementReference(elementId), x: 0, y: 0 },
          { type: "pointerDown", button: 2 },
          { type: "pointerUp",   button: 2 },
        ],
      }],
    });
  }

  async hover(selector: Selector): Promise<void> {
    const elementId = await this.findElement(selector);
    await this.request("POST", `/wd/hub/session/${this.sessionId}/actions`, {
      actions: [{
        type: "pointer",
        id: "mouse",
        parameters: { pointerType: "mouse" },
        actions: [
          {
            type: "pointerMove",
            duration: 100,
            origin: this.elementReference(elementId),
            x: 0,
            y: 0,
          },
        ],
      }],
    });
  }

  async check(selector: Selector): Promise<void> {
    const elementId = await this.findElement(selector);
    if (await this.isSelectedElement(elementId)) return;

    await this.request("POST", `/wd/hub/session/${this.sessionId}/element/${elementId}/click`);
  }

  async fill(selector: Selector, text: string): Promise<void> {
    const elementId = await this.findElement(selector);
    await this.request("POST", `/wd/hub/session/${this.sessionId}/element/${elementId}/clear`, {});
    // W3C spec requires both text (string) and value (char array) for compatibility
    await this.request("POST", `/wd/hub/session/${this.sessionId}/element/${elementId}/value`, {
      text,
      value: [...text],
    });
  }

  async select(selector: Selector, value: string): Promise<void> {
    // Click the select element, then find and click the option
    const elementId = await this.findElement(selector);
    await this.request("POST", `/wd/hub/session/${this.sessionId}/element/${elementId}/click`);
    const optionId = await this.findElement({ css: `option[value=${quoteCssAttributeValue(value)}]`, strategy: "css-path" });
    await this.request("POST", `/wd/hub/session/${this.sessionId}/element/${optionId}/click`);
  }

  async isDisplayed(selector: Selector): Promise<boolean> {
    try {
      const elementId = await this.findElement(selector);
      const result = await this.request("GET", `/wd/hub/session/${this.sessionId}/element/${elementId}/displayed`);
      return result === true;
    } catch (e: unknown) {
      if (e instanceof WebDriverError && (e.errorCode === "no such element" || e.message.includes("no such element"))) {
        return false;
      }
      throw e;
    }
  }

  private async isSelectedElement(elementId: string): Promise<boolean> {
    const result = await this.request("GET", `/wd/hub/session/${this.sessionId}/element/${elementId}/selected`);
    return result === true;
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

  async scrollTo(selector: Selector): Promise<void> {
    const elementId = await this.findElement(selector);
    await this.executeScript(
      "arguments[0].scrollIntoView({ block: 'center', inline: 'center' });",
      [this.elementReference(elementId)],
    );
  }

  async scrollBy(direction: "up" | "down", amount = 600): Promise<void> {
    const deltaY = direction === "up" ? -Math.abs(amount) : Math.abs(amount);
    await this.executeScript("window.scrollBy(0, arguments[0]);", [deltaY]);
  }

  async pressKey(key: string): Promise<void> {
    await this.pressKeys([key]);
  }

  async pressKeys(keys: string[]): Promise<void> {
    const mapped = keys.map(mapKey);
    await this.request("POST", `/wd/hub/session/${this.sessionId}/actions`, {
      actions: [{
        type: "key",
        id: "keyboard",
        actions: [
          ...mapped.map(v => ({ type: "keyDown", value: v })),
          ...[...mapped].reverse().map(v => ({ type: "keyUp", value: v })),
        ],
      }],
    });
  }

  // Upload a local file to an <input type="file"> element.
  // Uses the Selenium remote file upload protocol (POST /session/:id/file)
  // which packages the file as a ZIP before sending to the browser container.
  async uploadFile(selector: Selector, localFilePath: string): Promise<void> {
    const data     = readFileSync(localFilePath);
    const filename = basename(localFilePath);
    const zipBuf   = packZip(filename, data);
    const b64      = zipBuf.toString("base64");

    let remotePath: string;
    try {
      remotePath = await this.request(
        "POST", `/wd/hub/session/${this.sessionId}/file`, { file: b64 }
      ) as string;
    } catch {
      // Fall back to local path (works when browser runs on the same machine)
      remotePath = localFilePath;
    }

    const elementId = await this.findElement(selector);
    await this.request("POST", `/wd/hub/session/${this.sessionId}/element/${elementId}/value`, {
      text: remotePath, value: [...remotePath],
    });
  }

  async executeScript(script: string, args: unknown[] = []): Promise<unknown> {
    return this.request("POST", `/wd/hub/session/${this.sessionId}/execute/sync`, {
      script,
      args,
    });
  }

  async sendCdpCommand(cmd: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.request("POST", `/wd/hub/session/${this.sessionId}/goog/cdp/execute`, {
      cmd,
      params,
    });
  }

  async downloadVideo(filename: string): Promise<Buffer> {
    const url = `${this.baseUrl}/video/${filename}`;
    const controller = this.requestTimeoutMs > 0 ? new AbortController() : undefined;
    const timeout = controller
      ? setTimeout(() => controller.abort(), this.requestTimeoutMs)
      : undefined;
    try {
      const res = await fetch(url, { signal: controller?.signal });
      if (!res.ok) throw new Error(`Video download failed: ${res.status} ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private elementReference(elementId: string): Record<string, string> {
    return { [this.w3cElementKey]: elementId };
  }
}

function mapKey(key: string): string {
  const keyMap: Record<string, string> = {
    Enter:     "\uE007",
    Tab:       "\uE004",
    Escape:    "\uE00C",
    Backspace: "\uE003",
    Delete:    "\uE017",
    ArrowUp:   "\uE013",
    ArrowDown: "\uE015",
    ArrowLeft: "\uE012",
    ArrowRight:"\uE014",
    Control:   "\uE009",
    Shift:     "\uE008",
    Alt:       "\uE00A",
    Meta:      "\uE03D",
    Command:   "\uE03D",
    Home:      "\uE011",
    End:       "\uE010",
    PageUp:    "\uE00F",
    PageDown:  "\uE00E",
    F5:        "\uE035",
  };
  return keyMap[key] ?? key;
}

// Minimal single-file ZIP builder for Selenium remote file upload protocol.
function packZip(filename: string, data: Buffer): Buffer {
  const fnBuf   = Buffer.from(filename, 'utf8');
  const comp    = deflateRawSync(data);
  const crc     = crc32buf(data);
  const now     = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const lfh = Buffer.alloc(30 + fnBuf.length);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4); lfh.writeUInt16LE(0, 6); lfh.writeUInt16LE(8, 8);
  lfh.writeUInt16LE(dosTime, 10); lfh.writeUInt16LE(dosDate, 12);
  lfh.writeUInt32LE(crc, 14); lfh.writeUInt32LE(comp.length, 18); lfh.writeUInt32LE(data.length, 22);
  lfh.writeUInt16LE(fnBuf.length, 26); lfh.writeUInt16LE(0, 28);
  fnBuf.copy(lfh, 30);

  const cdh = Buffer.alloc(46 + fnBuf.length);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4); cdh.writeUInt16LE(20, 6); cdh.writeUInt16LE(0, 8); cdh.writeUInt16LE(8, 10);
  cdh.writeUInt16LE(dosTime, 12); cdh.writeUInt16LE(dosDate, 14);
  cdh.writeUInt32LE(crc, 16); cdh.writeUInt32LE(comp.length, 20); cdh.writeUInt32LE(data.length, 24);
  cdh.writeUInt16LE(fnBuf.length, 28);
  cdh.writeUInt16LE(0, 30); cdh.writeUInt16LE(0, 32); cdh.writeUInt16LE(0, 34);
  cdh.writeUInt16LE(0, 36); cdh.writeUInt32LE(0, 38); cdh.writeUInt32LE(0, 42);
  fnBuf.copy(cdh, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdh.length, 12); eocd.writeUInt32LE(lfh.length + comp.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([lfh, comp, cdh, eocd]);
}

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32buf(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function quoteCssAttributeValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

import type { ScreencastFrame } from "../scenario/types.js";
import type { WebDriverClient } from "./webdriver.js";

// Chrome 128+ ignores --remote-debugging-address=0.0.0.0 when --enable-automation is active.
// We use sendCdpCommand (Chromedriver HTTP path) for polling-based frame capture instead of
// a direct CDP WebSocket connection.
export class CdpSession {
  private frames: ScreencastFrame[] = [];
  private active = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private client: WebDriverClient | null = null;

  attach(client: WebDriverClient): void {
    this.client = client;
  }

  async startScreencast(intervalMs = 100): Promise<void> {
    if (!this.client || this.active) return;
    this.frames = [];
    this.active = true;

    this.timer = setInterval(async () => {
      if (!this.active || !this.client) return;
      try {
        const result = await this.client.sendCdpCommand("Page.captureScreenshot", {
          format: "jpeg",
          quality: 80,
          captureBeyondViewport: false,
        }) as { data: string };
        this.frames.push({
          timestampMs: Date.now(),
          data: Buffer.from(result.data, "base64"),
        });
      } catch {
        // ignore transient failures during polling
      }
    }, intervalMs);
  }

  stopScreencast(): ScreencastFrame[] {
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return [...this.frames];
  }

  close(): void {
    this.stopScreencast();
    this.client = null;
  }
}

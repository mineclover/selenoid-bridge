import type { BrowserTarget } from "../scenario/types.js";

export type RunCaptureMode = "all" | "failure" | "off";

export function parseBrowserTargets(value: string): BrowserTarget[] {
  const entries = value.split(",");
  const targets = entries.map((rawEntry) => {
    const entry = rawEntry.trim();
    if (!entry) {
      throw new Error("Invalid browsers: empty browser entry");
    }

    const parts = entry.split(":");
    if (parts.length > 2) {
      throw new Error(`Invalid browser entry: ${entry}`);
    }

    const browserName = parts[0].trim();
    const browserVersion = (parts[1] || "").trim();
    if (!browserName) {
      throw new Error(`Invalid browser entry: ${entry}`);
    }

    return { browserName, browserVersion };
  });

  if (targets.length === 0) {
    throw new Error("Invalid browsers: at least one browser is required");
  }

  return targets;
}

export function parseCaptureMode(value: string): RunCaptureMode {
  if (value === "all" || value === "failure" || value === "off") {
    return value;
  }
  throw new Error(`Invalid capture mode: ${value}`);
}

export function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { WebDriverClient } from "./webdriver.js";
import { CdpSession } from "./cdp.js";
import { saveCdpFrames, extractVideoFrames, buildTimingReport } from "./compare.js";
import type {
  BrowserTarget,
  RunArtifacts,
  RunOptions,
  RunResult,
  Scenario,
  ScreencastFrame,
  Selector,
  Step,
  StepResult,
  TimingReport,
} from "../scenario/types.js";

interface ActiveRecording {
  id: string;
  jsStartMs: number;
  cdp: CdpSession;
}

interface CompletedRecording {
  id: string;
  jsStartMs: number;
  jsEndMs: number;
  frames: ScreencastFrame[];
}

export async function runScenario(
  selenoidUrl: string,
  scenario: Scenario,
  browser: BrowserTarget,
  options: RunOptions = {},
): Promise<RunResult> {
  const client = new WebDriverClient(selenoidUrl, {
    requestTimeoutMs: options.requestTimeoutMs,
  });
  const stepResults: StepResult[] = [];
  const startTime = Date.now();
  const startedAt = new Date(startTime).toISOString();
  let failed = false;

  const activeRecordings = new Map<string, ActiveRecording>();
  const completedRecordings: CompletedRecording[] = [];
  const browserArtifactsDir = await ensureBrowserArtifactsDir(options.artifactsDir, browser);
  const videoName = `${slugify(`${browser.browserName}-${browser.browserVersion}`)}-${startTime}.mp4`;

  try {
    await client.createSession(
      browser,
      options.enableVideo ? { enableVideo: true, videoName } : undefined,
    );

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      const stepStart = Date.now();

      if (failed) {
        stepResults.push({
          step,
          index: i,
          status: "skipped",
          duration: 0,
        });
        continue;
      }

      try {
        const stepArtifacts = await executeStep(
          client,
          step,
          scenario.baseUrl,
          scenario.selectors,
          activeRecordings,
          completedRecordings,
        );
        const collected = await collectArtifacts(client, options.artifactsDir, browserArtifactsDir, step, i, "passed", options.capture);
        stepResults.push({
          step,
          index: i,
          status: "passed",
          duration: Date.now() - stepStart,
          artifacts: mergeArtifacts(collected, stepArtifacts),
        });
      } catch (e: unknown) {
        failed = true;
        const collected = await collectArtifacts(client, options.artifactsDir, browserArtifactsDir, step, i, "failed", options.capture);
        stepResults.push({
          step,
          index: i,
          status: "failed",
          duration: Date.now() - stepStart,
          error: e instanceof Error ? e.message : String(e),
          artifacts: collected,
        });
      }
    }
  } finally {
    // Close any still-active CDP sessions
    for (const rec of activeRecordings.values()) {
      const frames = rec.cdp.stopScreencast();
      rec.cdp.close();
      completedRecordings.push({ id: rec.id, jsStartMs: rec.jsStartMs, jsEndMs: Date.now(), frames });
    }
    activeRecordings.clear();

    try {
      await client.deleteSession();
    } catch {
      // ignore cleanup errors
    }
  }

  // Post-session: build timing reports for completed recordings
  const timingReports: TimingReport[] = [];
  for (const rec of completedRecordings) {
    if (!browserArtifactsDir) continue;

    const cdpFramesDir = join(browserArtifactsDir, `cdp-frames-${rec.id}`);
    await saveCdpFrames(rec.frames, cdpFramesDir).catch(() => undefined);

    let videoPath: string | undefined;
    let selenoidFrameTimestampsMs: number[] | undefined;

    if (options.enableVideo) {
      try {
        const videoBuffer = await client.downloadVideo(videoName);
        const absVideoPath = join(browserArtifactsDir, videoName);
        await writeFile(absVideoPath, videoBuffer);
        videoPath = relative(options.artifactsDir!, absVideoPath);

        const selenoidFramesDir = join(browserArtifactsDir, `selenoid-frames-${rec.id}`);
        selenoidFrameTimestampsMs = await extractVideoFrames(
          absVideoPath,
          selenoidFramesDir,
          startTime,
        ).catch(() => undefined);
      } catch {
        // video download or ffmpeg failed — report proceeds without selenoid frames
      }
    }

    timingReports.push(buildTimingReport(
      rec.id,
      rec.jsStartMs,
      rec.jsEndMs,
      rec.frames,
      selenoidFrameTimestampsMs,
      videoPath,
      relative(options.artifactsDir ?? browserArtifactsDir, cdpFramesDir),
    ));
  }

  return {
    browser,
    scenario: scenario.name,
    status: failed ? "failed" : "passed",
    steps: stepResults,
    duration: Date.now() - startTime,
    startedAt,
    finishedAt: new Date().toISOString(),
    artifactsDir: browserArtifactsDir,
    timingReports: timingReports.length > 0 ? timingReports : undefined,
  };
}

async function executeStep(
  client: WebDriverClient,
  step: Step,
  baseUrl: string,
  selectors: Scenario["selectors"],
  activeRecordings: Map<string, ActiveRecording>,
  completedRecordings: CompletedRecording[],
): Promise<RunArtifacts | undefined> {
  switch (step.action) {
    case "goto": {
      const url = step.url.startsWith("http") ? step.url : `${baseUrl}${step.url}`;
      await client.navigate(url);
      break;
    }
    case "click":
      await client.click(resolveSelectorForStep(step, selectors, "click"));
      break;

    case "fill":
      await client.fill(resolveSelectorForStep(step, selectors, "fill"), step.value);
      break;

    case "select":
      await client.select(resolveSelectorForStep(step, selectors, "select"), step.value);
      break;

    case "check":
      await client.check(resolveSelectorForStep(step, selectors, "check"));
      break;

    case "hover":
      await client.hover(resolveSelectorForStep(step, selectors, "hover"));
      break;

    case "scroll":
      if (step.selector || step.selectorKey) {
        await client.scrollTo(resolveSelectorForStep(step, selectors, "scroll"));
      }
      if (step.direction) {
        await client.scrollBy(step.direction, step.amount);
      }
      break;

    case "press":
      await client.pressKey(step.key);
      break;

    case "wait":
      if (step.selector) {
        await waitForElement(client, step.selector, step.ms || 5000);
      } else if (step.selectorKey) {
        await waitForElement(client, resolveSelectorForStep(step, selectors, "wait"), step.ms || 5000);
      } else {
        await sleep(step.ms || 1000);
      }
      break;

    case "assert":
      await executeAssert(client, step, selectors);
      break;

    case "record": {
      const recId = step.id ?? "default";
      if (step.mode === "start") {
        const cdp = new CdpSession();
        cdp.attach(client);
        await cdp.startScreencast();
        activeRecordings.set(recId, { id: recId, jsStartMs: Date.now(), cdp });
      } else {
        const rec = activeRecordings.get(recId);
        if (rec) {
          const frames = rec.cdp.stopScreencast();
          rec.cdp.close();
          activeRecordings.delete(recId);
          completedRecordings.push({ id: recId, jsStartMs: rec.jsStartMs, jsEndMs: Date.now(), frames });
        }
      }
      break;
    }

    case "measure": {
      const selector = step.selector ?? (step.selectorKey ? resolveSelectorForStep(step, selectors, "measure") : null);
      const event = step.event ?? "animationend";
      const timeoutMs = step.ms ?? 10_000;

      if (!selector) throw new Error("measure requires selector or selectorKey");

      const jsStartMs = await client.executeScript(`
        const el = document.querySelector(arguments[0]);
        if (!el) throw new Error("measure: element not found: " + arguments[0]);
        window.__bridge_measure = { done: false, endMs: 0 };
        el.addEventListener(arguments[1], function() {
          window.__bridge_measure.done = true;
          window.__bridge_measure.endMs = Date.now();
        }, { once: true });
        return Date.now();
      `, [selector.css, event]) as number;

      const deadline = Date.now() + timeoutMs;
      let jsEndMs = 0;
      while (Date.now() < deadline) {
        const done = await client.executeScript(`return !!(window.__bridge_measure && window.__bridge_measure.done);`) as boolean;
        if (done) {
          jsEndMs = await client.executeScript(`return window.__bridge_measure.endMs;`) as number;
          break;
        }
        await sleep(50);
      }
      if (!jsEndMs) throw new Error(`measure: timeout waiting for ${event} on ${selector.css}`);

      return {
        measureResult: {
          label: step.label,
          startMs: jsStartMs,
          endMs: jsEndMs,
          durationMs: jsEndMs - jsStartMs,
        },
      };
    }
  }
  return undefined;
}

async function executeAssert(
  client: WebDriverClient,
  step: Extract<Step, { action: "assert" }>,
  selectors: Scenario["selectors"],
): Promise<void> {
  switch (step.type) {
    case "visible": {
      const selector = resolveSelectorForStep(step, selectors, "assert visible");
      const visible = await client.isDisplayed(selector);
      if (!visible) throw new Error(`Element not visible: ${selector.css || selector.xpath}`);
      break;
    }
    case "hidden": {
      const selector = resolveSelectorForStep(step, selectors, "assert hidden");
      const visible = await client.isDisplayed(selector);
      if (visible) throw new Error(`Element should be hidden: ${selector.css || selector.xpath}`);
      break;
    }
    case "text": {
      if (!step.expected) throw new Error("assert text requires expected");
      const selector = resolveSelectorForStep(step, selectors, "assert text");
      const text = await client.getText(selector);
      if (!text.includes(step.expected)) {
        throw new Error(`Text mismatch: expected "${step.expected}", got "${text}"`);
      }
      break;
    }
    case "title": {
      if (!step.expected) throw new Error("assert title requires expected");
      const title = await client.getTitle();
      if (!title.includes(step.expected)) {
        throw new Error(`Title mismatch: expected "${step.expected}", got "${title}"`);
      }
      break;
    }
    case "url": {
      if (!step.expected) throw new Error("assert url requires expected");
      const url = await client.getUrl();
      if (!url.includes(step.expected)) {
        throw new Error(`URL mismatch: expected "${step.expected}", got "${url}"`);
      }
      break;
    }
    case "value": {
      if (!step.expected) throw new Error("assert value requires expected");
      const selector = resolveSelectorForStep(step, selectors, "assert value");
      const value = await client.getValue(selector);
      if (value !== step.expected) {
        throw new Error(`Value mismatch: expected "${step.expected}", got "${value}"`);
      }
      break;
    }
  }
}

async function waitForElement(client: WebDriverClient, selector: Selector, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.isDisplayed(selector)) return;
    await sleep(200);
  }
  throw new Error(`Timeout waiting for element: ${selector.css || selector.xpath}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runParallel(
  selenoidUrl: string,
  scenario: Scenario,
  browsers: BrowserTarget[],
  options: RunOptions = {},
): Promise<RunResult[]> {
  return runWithConcurrency(
    browsers,
    options.concurrency ?? browsers.length,
    (browser) => runScenario(selenoidUrl, scenario, browser, options),
  );
}

export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const requested = Number.isFinite(concurrency) ? Math.floor(concurrency) : items.length;
  const limit = Math.max(1, Math.min(items.length, requested));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await run(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

async function ensureBrowserArtifactsDir(
  artifactsDir: string | undefined,
  browser: BrowserTarget,
): Promise<string | undefined> {
  if (!artifactsDir) return undefined;
  const dir = join(artifactsDir, slugify(`${browser.browserName}-${browser.browserVersion}`));
  await mkdir(dir, { recursive: true });
  return dir;
}

async function collectArtifacts(
  client: WebDriverClient,
  artifactsRootDir: string | undefined,
  browserArtifactsDir: string | undefined,
  step: Step,
  index: number,
  status: "passed" | "failed",
  defaultCapture: RunOptions["capture"],
): Promise<RunArtifacts | undefined> {
  const artifacts: RunArtifacts = {};

  const pageUrl = await safeRead(() => client.getUrl());
  if (pageUrl) {
    artifacts.pageUrl = pageUrl;
  }

  const pageTitle = await safeRead(() => client.getTitle());
  if (pageTitle) {
    artifacts.pageTitle = pageTitle;
  }

  if (artifactsRootDir && browserArtifactsDir && shouldCaptureStep(step, status, defaultCapture)) {
    const screenshot = await safeRead(() => client.takeScreenshot());
    if (screenshot) {
      const fileName = `${String(index + 1).padStart(2, "0")}-${slugify(step.id || step.name || step.action)}-${status}.png`;
      const filePath = join(browserArtifactsDir, fileName);
      await writeFile(filePath, screenshot);
      artifacts.screenshotPath = relative(artifactsRootDir, filePath);
    }
  }

  return Object.keys(artifacts).length > 0 ? artifacts : undefined;
}

export function shouldCaptureStep(
  step: Step,
  status: "passed" | "failed",
  runCapture: RunOptions["capture"],
): boolean {
  if (runCapture === "all" || runCapture === "always") return true;
  if (runCapture === "off") return false;

  const preference = step.capture || "failure";
  if (preference === "off") return false;
  if (preference === "always") return true;
  return status === "failed";
}

function mergeArtifacts(
  base: RunArtifacts | undefined,
  extra: RunArtifacts | undefined,
): RunArtifacts | undefined {
  if (!extra) return base;
  return { ...base, ...extra };
}

async function safeRead<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "step";
}

function resolveSelectorForStep(
  step: { selector?: Selector; selectorKey?: string },
  selectors: Scenario["selectors"],
  action: string,
): Selector {
  if (step.selector) {
    return step.selector;
  }

  if (step.selectorKey && selectors?.[step.selectorKey]) {
    return selectors[step.selectorKey];
  }

  if (step.selectorKey) {
    throw new Error(`Missing selector mapping for "${step.selectorKey}" (${action})`);
  }

  throw new Error(`${action} requires selector or selectorKey`);
}

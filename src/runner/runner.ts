import { WebDriverClient } from "./webdriver.js";
import type { Scenario, Step, BrowserTarget, RunResult, StepResult } from "../scenario/types.js";

export async function runScenario(
  selenoidUrl: string,
  scenario: Scenario,
  browser: BrowserTarget,
): Promise<RunResult> {
  const client = new WebDriverClient(selenoidUrl);
  const stepResults: StepResult[] = [];
  const startTime = Date.now();
  let failed = false;

  try {
    await client.createSession(browser);

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
        await executeStep(client, step, scenario.baseUrl);
        stepResults.push({
          step,
          index: i,
          status: "passed",
          duration: Date.now() - stepStart,
        });
      } catch (e: unknown) {
        failed = true;
        stepResults.push({
          step,
          index: i,
          status: "failed",
          duration: Date.now() - stepStart,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } finally {
    try {
      await client.deleteSession();
    } catch { /* ignore cleanup errors */ }
  }

  return {
    browser,
    scenario: scenario.name,
    status: failed ? "failed" : "passed",
    steps: stepResults,
    duration: Date.now() - startTime,
  };
}

async function executeStep(client: WebDriverClient, step: Step, baseUrl: string): Promise<void> {
  switch (step.action) {
    case "goto": {
      const url = step.url.startsWith("http") ? step.url : `${baseUrl}${step.url}`;
      await client.navigate(url);
      break;
    }
    case "click":
      await client.click(step.selector);
      break;

    case "fill":
      await client.fill(step.selector, step.value);
      break;

    case "select":
      await client.select(step.selector, step.value);
      break;

    case "check":
    case "hover":
      await client.click(step.selector);
      break;

    case "press":
      await client.pressKey(step.key);
      break;

    case "wait":
      if (step.selector) {
        await waitForElement(client, step.selector, step.ms || 5000);
      } else {
        await sleep(step.ms || 1000);
      }
      break;

    case "assert":
      await executeAssert(client, step);
      break;
  }
}

async function executeAssert(
  client: WebDriverClient,
  step: Extract<Step, { action: "assert" }>,
): Promise<void> {
  switch (step.type) {
    case "visible": {
      if (!step.selector) throw new Error("assert visible requires selector");
      const visible = await client.isDisplayed(step.selector);
      if (!visible) throw new Error(`Element not visible: ${step.selector.css || step.selector.xpath}`);
      break;
    }
    case "hidden": {
      if (!step.selector) throw new Error("assert hidden requires selector");
      const visible = await client.isDisplayed(step.selector);
      if (visible) throw new Error(`Element should be hidden: ${step.selector.css || step.selector.xpath}`);
      break;
    }
    case "text": {
      if (!step.selector || !step.expected) throw new Error("assert text requires selector and expected");
      const text = await client.getText(step.selector);
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
      if (!step.selector || !step.expected) throw new Error("assert value requires selector and expected");
      const value = await client.getValue(step.selector);
      if (value !== step.expected) {
        throw new Error(`Value mismatch: expected "${step.expected}", got "${value}"`);
      }
      break;
    }
  }
}

async function waitForElement(
  client: WebDriverClient,
  selector: { css: string; xpath?: string; strategy: string },
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.isDisplayed(selector as import("../scenario/types.js").Selector)) return;
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
): Promise<RunResult[]> {
  return Promise.all(
    browsers.map((browser) => runScenario(selenoidUrl, scenario, browser)),
  );
}

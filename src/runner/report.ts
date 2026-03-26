import type { RunResult } from "../scenario/types.js";

export function printReport(results: RunResult[]): void {
  console.log("\n=== Test Results ===\n");

  for (const result of results) {
    const icon = result.status === "passed" ? "\u2713" : "\u2717";
    const browser = `${result.browser.browserName}:${result.browser.browserVersion}`;
    console.log(`${icon} [${browser}] ${result.scenario} (${result.duration}ms)`);

    for (const step of result.steps) {
      const stepIcon =
        step.status === "passed" ? "  \u2713" :
        step.status === "failed" ? "  \u2717" : "  -";

      let desc = step.step.action;
      if ("url" in step.step) desc += ` ${step.step.url}`;
      if ("selector" in step.step && step.step.selector) {
        desc += ` ${step.step.selector.css || step.step.selector.xpath}`;
      }
      if ("value" in step.step && step.step.value) desc += ` "${step.step.value}"`;

      console.log(`${stepIcon} [${step.duration}ms] ${desc}`);
      if (step.error) {
        console.log(`     Error: ${step.error}`);
      }
    }
    console.log();
  }

  const passed = results.filter((r) => r.status === "passed").length;
  const total = results.length;
  console.log(`${passed}/${total} browsers passed\n`);
}

export function toJsonReport(results: RunResult[]): string {
  return JSON.stringify(results, null, 2);
}

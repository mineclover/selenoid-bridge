#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import { validateScenario } from "./scenario/validate.js";
import { runParallel } from "./runner/runner.js";
import { printReport, toJsonReport } from "./runner/report.js";
import type { BrowserTarget, Scenario } from "./scenario/types.js";

const program = new Command();

program
  .name("selenoid-bridge")
  .description("Bridge between agent-browser and Selenoid for cross-browser test execution")
  .version("0.1.0");

program
  .command("run")
  .description("Run a test scenario on Selenoid")
  .argument("<scenario>", "Path to scenario JSON file")
  .option("-s, --selenoid <url>", "Selenoid URL", "http://localhost:4444")
  .option("-b, --browsers <list>", "Comma-separated browser:version list", "chrome:128.0")
  .option("-o, --output <file>", "Write JSON report to file")
  .action(async (scenarioPath: string, opts: { selenoid: string; browsers: string; output?: string }) => {
    const raw = readFileSync(scenarioPath, "utf-8");
    const scenario = validateScenario(JSON.parse(raw));

    const browsers: BrowserTarget[] = opts.browsers.split(",").map((b) => {
      const [browserName, browserVersion] = b.split(":");
      return { browserName, browserVersion: browserVersion || "latest" };
    });

    console.log(`Running "${scenario.name}" on ${browsers.length} browser(s)...`);
    console.log(`Selenoid: ${opts.selenoid}`);

    const results = await runParallel(opts.selenoid, scenario, browsers);

    printReport(results);

    if (opts.output) {
      writeFileSync(opts.output, toJsonReport(results));
      console.log(`Report saved to ${opts.output}`);
    }

    const allPassed = results.every((r) => r.status === "passed");
    process.exit(allPassed ? 0 : 1);
  });

program
  .command("validate")
  .description("Validate a scenario JSON file")
  .argument("<scenario>", "Path to scenario JSON file")
  .action((scenarioPath: string) => {
    const raw = readFileSync(scenarioPath, "utf-8");
    try {
      validateScenario(JSON.parse(raw));
      console.log("Scenario is valid.");
    } catch (e: unknown) {
      console.error("Validation error:", e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });

program
  .command("create")
  .description("Create a scenario from a template")
  .argument("<name>", "Scenario name")
  .option("-u, --url <url>", "Base URL", "https://example.com")
  .option("-o, --output <file>", "Output file path")
  .action((name: string, opts: { url: string; output?: string }) => {
    const scenario: Scenario = {
      name,
      baseUrl: opts.url,
      steps: [
        { action: "goto", url: "/" },
      ],
      metadata: {
        recordedAt: new Date().toISOString(),
        recordedWith: "selenoid-bridge",
      },
    };

    const json = JSON.stringify(scenario, null, 2);
    const outFile = opts.output || `${name.replace(/\s+/g, "-").toLowerCase()}.json`;
    writeFileSync(outFile, json);
    console.log(`Scenario template created: ${outFile}`);
  });

program.parse();

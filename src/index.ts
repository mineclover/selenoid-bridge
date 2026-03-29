#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { printReport, toHtmlReport, toJsonReport } from "./runner/report.js";
import { runParallel } from "./runner/runner.js";
import { createScenarioTemplate, type ScenarioTemplate } from "./scenario/templates.js";
import type { BrowserTarget } from "./scenario/types.js";
import { validateScenario } from "./scenario/validate.js";

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
  .option("-a, --artifacts-dir <dir>", "Directory for screenshots and HTML/JSON reports")
  .option("-c, --capture <mode>", "Capture mode: all, failure, off", "all")
  .action(async (scenarioPath: string, opts: {
    selenoid: string;
    browsers: string;
    output?: string;
    artifactsDir?: string;
    capture: string;
  }) => {
    if (!["all", "failure", "off"].includes(opts.capture)) {
      console.error(`Invalid capture mode: ${opts.capture}`);
      process.exit(1);
    }

    const raw = readFileSync(scenarioPath, "utf-8");
    const scenario = validateScenario(JSON.parse(raw));

    const browsers: BrowserTarget[] = opts.browsers.split(",").map((entry) => {
      const [browserName, browserVersion] = entry.split(":");
      return { browserName, browserVersion: browserVersion || "latest" };
    });

    const artifactsDir = resolve(
      opts.artifactsDir || join(process.cwd(), "artifacts", `${slugify(scenario.name)}-${timestampLabel()}`),
    );
    mkdirSync(artifactsDir, { recursive: true });

    console.log(`Running "${scenario.name}" on ${browsers.length} browser(s)...`);
    console.log(`Selenoid: ${opts.selenoid}`);
    console.log(`Artifacts: ${artifactsDir}`);

    const results = await runParallel(opts.selenoid, scenario, browsers, {
      artifactsDir,
      capture: opts.capture as "all" | "failure" | "off",
    });

    printReport(results);

    const jsonReportPath = resolve(opts.output || join(artifactsDir, "report.json"));
    const htmlReportPath = join(artifactsDir, "report.html");

    writeFileSync(jsonReportPath, toJsonReport(results));
    writeFileSync(htmlReportPath, toHtmlReport(results));

    console.log(`JSON report saved to ${jsonReportPath}`);
    console.log(`HTML report saved to ${htmlReportPath}`);

    const allPassed = results.every((result) => result.status === "passed");
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
  .description("Create a standardized scenario template")
  .argument("<name>", "Scenario name")
  .option("-u, --url <url>", "Base URL", "https://example.com")
  .option("-o, --output <file>", "Output file path")
  .option("-t, --template <name>", "Template: blank, commerce-checkout", "blank")
  .action((name: string, opts: { url: string; output?: string; template: string }) => {
    if (!["blank", "commerce-checkout"].includes(opts.template)) {
      console.error(`Invalid template: ${opts.template}`);
      process.exit(1);
    }

    const scenario = createScenarioTemplate(name, opts.url, opts.template as ScenarioTemplate);
    const json = JSON.stringify(scenario, null, 2);
    const outFile = opts.output || `${name.replace(/\s+/g, "-").toLowerCase()}.json`;

    writeFileSync(outFile, json);
    console.log(`Scenario template created: ${outFile}`);
    console.log(`Template: ${opts.template}`);
  });

program.parse();

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "scenario";
}

function timestampLabel(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
}

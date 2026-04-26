#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename, extname, dirname } from "node:path";
import { Command } from "commander";
import { parseBrowserTargets, parseCaptureMode, parsePositiveInteger } from "./cli/options.js";
import { printReport, toHtmlReport, toJsonReport } from "./runner/report.js";
import { runParallel } from "./runner/runner.js";
import { createScenarioTemplate, type ScenarioTemplate } from "./scenario/templates.js";
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
  .option("-b, --browsers <list>", "Comma-separated browser[:version] list", "chrome:128.0")
  .option("-o, --output <file>", "Write JSON report to file")
  .option("-a, --artifacts-dir <dir>", "Directory for screenshots and HTML/JSON reports")
  .option("-c, --capture <mode>", "Capture mode: all, failure, off", "failure")
  .option("--concurrency <count>", "Max parallel browser runs", "5")
  .option("--request-timeout <ms>", "WebDriver request timeout in milliseconds", "30000")
  .option("--enable-video", "Record session video via Selenoid and download after run")
  .action(async (scenarioPath: string, opts: {
    selenoid: string;
    browsers: string;
    output?: string;
    artifactsDir?: string;
    capture: string;
    concurrency: string;
    requestTimeout: string;
    enableVideo?: boolean;
  }) => {
    let capture: "all" | "failure" | "off";
    let concurrency: number;
    let requestTimeoutMs: number;
    let browsers: ReturnType<typeof parseBrowserTargets>;
    try {
      capture = parseCaptureMode(opts.capture);
      concurrency = parsePositiveInteger(opts.concurrency, "concurrency");
      requestTimeoutMs = parsePositiveInteger(opts.requestTimeout, "request-timeout");
      browsers = parseBrowserTargets(opts.browsers);
    } catch (e: unknown) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }

    const raw = readFileSync(scenarioPath, "utf-8");
    const scenario = validateScenario(JSON.parse(raw));

    const artifactsDir = resolve(
      opts.artifactsDir || join(process.cwd(), "artifacts", `${slugify(scenario.name)}-${timestampLabel()}`),
    );
    mkdirSync(artifactsDir, { recursive: true });

    console.log(`Running "${scenario.name}" on ${browsers.length} browser(s)...`);
    console.log(`Selenoid: ${opts.selenoid}`);
    console.log(`Artifacts: ${artifactsDir}`);

    if (opts.enableVideo) {
      console.log("Video recording: enabled");
    }

    const results = await runParallel(opts.selenoid, scenario, browsers, {
      artifactsDir,
      capture,
      concurrency,
      requestTimeoutMs,
      enableVideo: opts.enableVideo ?? false,
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

program
  .command("render")
  .description("Render an HTML composition to video via the hyperframes renderer")
  .argument("<source>", "Path to HTML file or http(s):// URL with window.__hf")
  .option("-r, --renderer <url>", "Hyperframes renderer URL", "http://localhost:9847")
  .option("-o, --output <file>", "Output video path")
  .option("--fps <n>", "Frames per second", "30")
  .option("--quality <q>", "Quality: draft, standard, high", "standard")
  .option("--format <f>", "Output format: mp4, webm", "mp4")
  .option("--width <n>", "Viewport width in px", "1280")
  .option("--height <n>", "Viewport height in px", "720")
  .option("--files <dir>", "Asset directory (default: same dir as HTML)")
  .action(async (source: string, opts: {
    renderer: string;
    output?: string;
    fps: string;
    quality: string;
    format: string;
    width: string;
    height: string;
    files?: string;
  }) => {
    const rendererUrl = opts.renderer.replace(/\/$/, "");

    // Health check
    try {
      const health = await fetch(`${rendererUrl}/health`);
      if (!health.ok) throw new Error(`status ${health.status}`);
    } catch (e) {
      console.error(`Renderer not reachable at ${rendererUrl}: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    }

    // Resolve source to html string or previewUrl
    let body: Record<string, unknown>;
    if (source.startsWith("http://") || source.startsWith("https://")) {
      body = { previewUrl: source };
    } else {
      const htmlPath = resolve(source);
      body = { html: readFileSync(htmlPath, "utf-8") };
      // Auto-include sibling files in the same directory as the HTML
      // (unless --files points elsewhere)
      const assetsDir = resolve(opts.files ?? dirname(htmlPath));
      const { files, meta } = collectAssets(assetsDir, htmlPath);
      if (Object.keys(files).length > 0) {
        body.files = files;
        body.meta = meta;
        const names = Object.keys(files);
        console.log(`Assets: ${names.join(", ")}`);
        const withMeta = Object.keys(meta);
        if (withMeta.length > 0) console.log(`Frame meta: ${withMeta.map(n => `${n}(${meta[n].frameWidth}x${meta[n].frameHeight})`).join(", ")}`);
      }
    }

    body = {
      ...body,
      fps: parseInt(opts.fps, 10),
      quality: opts.quality,
      format: opts.format,
      width: parseInt(opts.width, 10),
      height: parseInt(opts.height, 10),
    };

    console.log(`Rendering via ${rendererUrl} (fps=${opts.fps}, quality=${opts.quality})...`);

    const res = await fetch(`${rendererUrl}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30 * 60 * 1000), // 30 min max
    });

    const result = await res.json() as {
      success: boolean;
      error?: string;
      outputToken?: string;
      outputUrl?: string;
      durationMs?: number;
      fileSize?: number;
    };

    if (!result.success || !result.outputToken) {
      console.error(`Render failed: ${result.error ?? "unknown error"}`);
      process.exit(1);
    }

    // Download video
    const downloadUrl = `${rendererUrl}/outputs/${result.outputToken}`;
    const videoRes = await fetch(downloadUrl);
    if (!videoRes.ok) {
      console.error(`Download failed: ${videoRes.status}`);
      process.exit(1);
    }

    const srcName = source.startsWith("http") ? "output" : basename(source, ".html");
    const outPath = resolve(opts.output ?? `${srcName}.${opts.format}`);
    writeFileSync(outPath, Buffer.from(await videoRes.arrayBuffer()));

    const secs = ((result.durationMs ?? 0) / 1000).toFixed(1);
    const kb = Math.round((result.fileSize ?? 0) / 1024);
    console.log(`Saved: ${outPath} (${kb}KB, rendered in ${secs}s)`);
  });

program.parse();

const ASSET_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".css", ".js", ".woff", ".woff2"]);

interface FileMeta { frameWidth?: number; frameHeight?: number }

function collectAssets(dir: string, excludeHtml: string): {
  files: Record<string, string>;
  meta: Record<string, FileMeta>;
} {
  const files: Record<string, string> = {};
  const meta: Record<string, FileMeta> = {};
  try {
    for (const name of readdirSync(dir)) {
      const fullPath = join(dir, name);
      if (!statSync(fullPath).isFile()) continue;
      const ext = extname(name).toLowerCase();

      // Asset file
      if (ASSET_EXTS.has(ext) && fullPath !== excludeHtml) {
        files[name] = readFileSync(fullPath).toString("base64");
      }

      // Sidecar: sprite.png.meta.json  →  meta for sprite.png
      if (name.endsWith(".meta.json")) {
        const assetName = name.replace(/\.meta\.json$/, "");
        try {
          const data = JSON.parse(readFileSync(fullPath, "utf-8")) as FileMeta;
          if (data.frameWidth || data.frameHeight) meta[assetName] = data;
        } catch { /* skip malformed */ }
      }
    }
  } catch { /* dir not readable */ }
  return { files, meta };
}

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

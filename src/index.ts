#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename, extname, dirname } from "node:path";
import { deflateSync } from "node:zlib";
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

// ─── Synthetic PNG helpers for --test mode ────────────────────────────────────

function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) c = (c & 1) ? (c >>> 1) ^ 0xEDB88320 : c >>> 1;
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}

function makeRGBAPNG(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // bit depth=8, color type=RGBA
  const stride = 1 + w * 4;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter None
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = px(x, y);
      const o = y * stride + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

function makeColorStrip(fw: number, fh: number, colors: [number, number, number, number][]): Buffer {
  return makeRGBAPNG(fw * colors.length, fh, (x, y) => {
    void y;
    return colors[Math.floor(x / fw)];
  });
}

// Hollow rectangle: each frame rotated by (fi/n)*2π — transparent inside, semi-transparent border
function makeHollowRectStrip(
  fw: number, fh: number,
  rgb: [number, number, number],
  borderW: number,
  nFrames: number,
  alpha = 200,
): Buffer {
  const cx = fw / 2, cy = fh / 2;
  const hw = fw * 0.38, hh = fh * 0.38;
  const aa = 1.5; // antialiasing softness in pixels
  return makeRGBAPNG(fw * nFrames, fh, (x, y) => {
    const fi = Math.floor(x / fw);
    const angle = (fi / nFrames) * 2 * Math.PI;
    const lx = (x % fw) - cx, ly = y - cy;
    const cos = Math.cos(-angle), sin = Math.sin(-angle);
    const rx = lx * cos - ly * sin, ry = lx * sin + ly * cos;
    // Signed distance from each edge (positive = inside)
    const dOuter = Math.min(hw - Math.abs(rx), hh - Math.abs(ry));
    const dInner = Math.min(Math.abs(rx) - (hw - borderW), Math.abs(ry) - (hh - borderW));
    if (dOuter < -aa || dInner < -aa) return [0, 0, 0, 0];
    const edgeFade = Math.min(
      Math.min(1, (dOuter + aa) / (aa * 2)),
      Math.min(1, (dInner + aa) / (aa * 2)),
    );
    return [rgb[0], rgb[1], rgb[2], Math.round(alpha * edgeFade)];
  });
}

// Hollow ring: single frame, transparent interior/exterior, soft edges
function makeHollowRingSprite(
  fw: number, fh: number,
  rgb: [number, number, number],
  innerFrac: number,
  alpha = 200,
): Buffer {
  const cx = fw / 2, cy = fh / 2;
  const outerR = Math.min(cx, cy) * 0.9;
  const innerR = outerR * innerFrac;
  const aa = 1.5;
  return makeRGBAPNG(fw, fh, (x, y) => {
    const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    const dOuter = outerR - d; // positive inside
    const dInner = d - innerR; // positive inside ring
    if (dOuter < -aa || dInner < -aa) return [0, 0, 0, 0];
    const edgeFade = Math.min(
      Math.min(1, (dOuter + aa) / (aa * 2)),
      Math.min(1, (dInner + aa) / (aa * 2)),
    );
    return [rgb[0], rgb[1], rgb[2], Math.round(alpha * edgeFade)];
  });
}

// Hollow diamond (rotated square): each frame rotated by (fi/n)*2π, semi-transparent
function makeHollowDiamondStrip(
  fw: number, fh: number,
  rgb: [number, number, number],
  borderW: number,
  nFrames: number,
  alpha = 200,
): Buffer {
  const cx = fw / 2, cy = fh / 2;
  const ds = Math.min(fw, fh) * 0.42;
  const aa = 1.5;
  return makeRGBAPNG(fw * nFrames, fh, (x, y) => {
    const fi = Math.floor(x / fw);
    const angle = Math.PI / 4 + (fi / nFrames) * 2 * Math.PI;
    const lx = (x % fw) - cx, ly = y - cy;
    const cos = Math.cos(-angle), sin = Math.sin(-angle);
    const rx = lx * cos - ly * sin, ry = lx * sin + ly * cos;
    const manhattanOuter = Math.abs(rx) + Math.abs(ry);
    const dOuter = ds - manhattanOuter;
    const dInner = manhattanOuter - (ds - borderW);
    if (dOuter < -aa || dInner < -aa) return [0, 0, 0, 0];
    const edgeFade = Math.min(
      Math.min(1, (dOuter + aa) / (aa * 2)),
      Math.min(1, (dInner + aa) / (aa * 2)),
    );
    return [rgb[0], rgb[1], rgb[2], Math.round(alpha * edgeFade)];
  });
}

// ─── render-sprites command ───────────────────────────────────────────────────

type SpriteLayerDef = {
  name: string;
  file: string;        // base64 encoded image OR filesystem path
  frameWidth: number;
  frameHeight: number;
  rows?: number;
  x?: number;
  y?: number;
  xExpr?: string;     // FFmpeg overlay x expression (uses t, main_w, overlay_w, ...)
  yExpr?: string;
  loop?: boolean;
};

program
  .command("render-sprites")
  .description("Render sprite sheet layers into a composited MP4 via hf-renderer")
  .option("-r, --renderer <url>", "hf-renderer URL", "http://localhost:9847")
  .option("--layers <file>", "JSON array: [{name, file(path|base64), frameWidth, frameHeight, ...}]")
  .option("--fps <n>", "Frames per second", "30")
  .option("--duration <s>", "Duration in seconds (auto from sprite frame count if omitted)")
  .option("--width <n>", "Canvas width", "1280")
  .option("--height <n>", "Canvas height", "720")
  .option("--quality <q>", "draft | standard | high", "standard")
  .option("--transparent", "No background, VP9 WebM output with alpha channel preserved")
  .option("-o, --output <file>", "Output file (default: sprites.mp4 or sprites.webm if --transparent)")
  .option("--test", "Generate synthetic test sprites (no --layers needed)")
  .action(async (opts: {
    renderer: string; layers?: string; fps: string; duration?: string;
    width: string; height: string; quality: string; transparent?: boolean;
    output?: string; test?: boolean;
  }) => {
    const rendererUrl = opts.renderer.replace(/\/$/, "");
    try {
      const h = await fetch(`${rendererUrl}/health`);
      if (!h.ok) throw new Error(`status ${h.status}`);
    } catch (e) {
      console.error(`Renderer not reachable at ${rendererUrl}: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    }

    let layerDefs: SpriteLayerDef[];

    if (opts.test) {
      const canvasW = parseInt(opts.width, 10), canvasH = parseInt(opts.height, 10);
      const N = 16; // rotation frames per shape
      console.log("Generating test sprites (5 crossing rotating hollow shapes)...");

      // Layer 0: dark background cycling 4 deep colors
      const bgStrip = makeColorStrip(canvasW, canvasH, [
        [10, 15, 40, 255], [25, 10, 45, 255], [10, 35, 40, 255], [20, 10, 35, 255],
      ]);
      // Layer 1: cyan hollow rectangle — CW orbit
      const rectStrip    = makeHollowRectStrip(120, 120, [0, 220, 230],   10, N, 180);
      // Layer 2: yellow hollow ring — CCW orbit (ring is symmetric, single frame)
      const ringSprite   = makeHollowRingSprite(150, 150, [250, 210, 40], 0.5,    180);
      // Layer 3: magenta hollow diamond — faster orbit, opposite phase
      const diamondStrip = makeHollowDiamondStrip(100, 100, [230, 50, 220], 8, N, 180);
      // Layer 4: white hollow rectangle (smaller) — counter-orbit, 90° phase shift
      const rect2Strip   = makeHollowRectStrip(90, 90, [200, 200, 200],   6, N, 180);

      layerDefs = [
        {
          name: "bg.png",
          file: bgStrip.toString("base64"),
          frameWidth: canvasW, frameHeight: canvasH,
        },
        {
          name: "rect.png",
          file: rectStrip.toString("base64"),
          frameWidth: 120, frameHeight: 120,
          xExpr: "main_w/2 - overlay_w/2 + main_w*0.28*cos(t*1.5)",
          yExpr: "main_h/2 - overlay_h/2 + main_h*0.30*sin(t*1.5)",
        },
        {
          name: "ring.png",
          file: ringSprite.toString("base64"),
          frameWidth: 150, frameHeight: 150,
          xExpr: "main_w/2 - overlay_w/2 + main_w*0.32*cos(-t*1.1)",
          yExpr: "main_h/2 - overlay_h/2 + main_h*0.28*sin(-t*1.1)",
        },
        {
          name: "diamond.png",
          file: diamondStrip.toString("base64"),
          frameWidth: 100, frameHeight: 100,
          xExpr: "main_w/2 - overlay_w/2 + main_w*0.22*cos(t*2.4 + 3.14159)",
          yExpr: "main_h/2 - overlay_h/2 + main_h*0.24*sin(t*2.4 + 3.14159)",
        },
        {
          name: "rect2.png",
          file: rect2Strip.toString("base64"),
          frameWidth: 90, frameHeight: 90,
          xExpr: "main_w/2 - overlay_w/2 + main_w*0.38*cos(-t*1.8 + 1.5708)",
          yExpr: "main_h/2 - overlay_h/2 + main_h*0.35*sin(-t*1.8 + 1.5708)",
        },
      ];
    } else if (opts.layers) {
      const rawDefs = JSON.parse(readFileSync(resolve(opts.layers), "utf-8")) as SpriteLayerDef[];
      layerDefs = rawDefs.map(d => ({
        ...d,
        file: d.file.startsWith("data:") ? d.file.split(",")[1]
          : d.file.length > 200 && /^[A-Za-z0-9+/=]+$/.test(d.file.slice(0, 50)) ? d.file
          : readFileSync(resolve(d.file)).toString("base64"),
      }));
    } else {
      console.error("Provide --layers <file.json> or --test");
      process.exit(1);
    }

    console.log(`Layers: ${layerDefs.map(l => `${l.name} (${l.frameWidth}×${l.frameHeight} ×${l.rows ?? 1}r)`).join(", ")}`);
    console.log(`Posting to ${rendererUrl}/render/sprites (fps=${opts.fps}, quality=${opts.quality})...`);

    const defaultOutput = opts.transparent ? "sprites.webm" : "sprites.mp4";
    const body = {
      layers: layerDefs,
      fps: parseInt(opts.fps, 10),
      ...(opts.duration ? { duration: parseFloat(opts.duration) } : {}),
      width: parseInt(opts.width, 10),
      height: parseInt(opts.height, 10),
      quality: opts.quality,
      transparent: opts.transparent ?? false,
    };

    const res = await fetch(`${rendererUrl}/render/sprites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });

    const result = await res.json() as {
      success: boolean; error?: string;
      outputToken?: string; durationMs?: number; fileSize?: number;
    };

    if (!result.success || !result.outputToken) {
      console.error(`Render failed: ${result.error ?? "unknown error"}`);
      process.exit(1);
    }

    const videoRes = await fetch(`${rendererUrl}/outputs/${result.outputToken}`);
    if (!videoRes.ok) { console.error(`Download failed: ${videoRes.status}`); process.exit(1); }

    const outPath = resolve(opts.output ?? defaultOutput);
    writeFileSync(outPath, Buffer.from(await videoRes.arrayBuffer()));
    const secs = ((result.durationMs ?? 0) / 1000).toFixed(1);
    const kb   = Math.round((result.fileSize ?? 0) / 1024);
    console.log(`Saved: ${outPath} (${kb}KB, rendered in ${secs}s)`);
  });

program.parse();

const ASSET_EXTS  = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".css", ".js", ".woff", ".woff2"]);
const IMAGE_EXTS  = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]);
const SEQ_PATTERN = /^(.+?)_?(\d{2,})\.(png|jpe?g|gif|webp|avif)$/i;

// B: size limits (matching server)
const FILE_WARN_BYTES  = 10 * 1024 * 1024;  // warn at 10MB
const FILE_LIMIT_BYTES = 20 * 1024 * 1024;  // hard limit 20MB

interface FileMeta { frameWidth?: number; frameHeight?: number; rows?: number; renderMode?: string }

function collectAssets(dir: string, excludeHtml: string): {
  files: Record<string, string>;
  meta: Record<string, FileMeta>;
} {
  const files: Record<string, string> = {};
  const meta: Record<string, FileMeta> = {};
  const seqCandidates = new Map<string, string[]>(); // key → [name, ...]

  try {
    const names = readdirSync(dir).sort();
    for (const name of names) {
      const fullPath = join(dir, name);
      if (!statSync(fullPath).isFile()) continue;
      const ext = extname(name).toLowerCase();

      // Asset file — B: size check
      if (ASSET_EXTS.has(ext) && fullPath !== excludeHtml) {
        const size = statSync(fullPath).size;
        if (size > FILE_LIMIT_BYTES) {
          console.warn(`  SKIP "${name}" (${Math.round(size/1024/1024)}MB > 20MB limit) — split into grid or sequence`);
          continue;
        }
        if (size > FILE_WARN_BYTES) {
          console.warn(`  WARN "${name}" is ${Math.round(size/1024/1024)}MB — consider splitting`);
        }
        files[name] = readFileSync(fullPath).toString("base64");

        // C: collect sequence candidates
        if (IMAGE_EXTS.has(ext)) {
          const m = name.match(SEQ_PATTERN);
          if (m) {
            const seqKey = `${m[1]}.${m[3].toLowerCase()}`;
            if (!seqCandidates.has(seqKey)) seqCandidates.set(seqKey, []);
            seqCandidates.get(seqKey)!.push(name);
          }
        }
      }

      // Sidecar: sprite.png.meta.json → meta for sprite.png
      if (name.endsWith(".meta.json")) {
        const assetName = name.replace(/\.meta\.json$/, "");
        try {
          const data = JSON.parse(readFileSync(fullPath, "utf-8")) as FileMeta;
          if (data.frameWidth || data.frameHeight || data.rows) meta[assetName] = data;
        } catch { /* skip malformed */ }
      }
    }
  } catch { /* dir not readable */ }

  // C: emit sequence meta for groups with ≥2 frames
  for (const [seqKey, frameNames] of seqCandidates) {
    if (frameNames.length < 2) continue;
    // Sequence meta inherits any existing sidecar meta
    if (!meta[seqKey]) meta[seqKey] = {};
    // Log detection
    console.log(`  Sequence "${seqKey}" → ${frameNames.length} frames`);
  }

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

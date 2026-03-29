import type { RunResult, Step } from "../scenario/types.js";

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

      console.log(`${stepIcon} [${step.duration}ms] ${describeStep(step.step)}`);

      if (step.artifacts?.pageUrl) {
        console.log(`     URL: ${step.artifacts.pageUrl}`);
      }
      if (step.artifacts?.pageTitle) {
        console.log(`     Title: ${step.artifacts.pageTitle}`);
      }
      if (step.artifacts?.screenshotPath) {
        console.log(`     Capture: ${step.artifacts.screenshotPath}`);
      }
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
  const generatedAt = new Date().toISOString();
  return JSON.stringify(
    {
      generatedAt,
      summary: createSummary(results),
      results,
    },
    null,
    2,
  );
}

export function toHtmlReport(results: RunResult[]): string {
  const summary = createSummary(results);
  const scenarioName = results[0]?.scenario || "Scenario";
  const generatedAt = new Date().toISOString();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(scenarioName)} Report</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7fb;
      --panel: #ffffff;
      --border: #dde2ea;
      --text: #172033;
      --muted: #5d6983;
      --pass: #18794e;
      --fail: #c2410c;
      --skip: #7c879d;
      --accent: #1d4ed8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px;
      background: linear-gradient(180deg, #eef3ff 0%, var(--bg) 220px);
      color: var(--text);
      font-family: "SF Pro Display", "Segoe UI", sans-serif;
    }
    h1, h2, h3, p { margin: 0; }
    .stack { display: grid; gap: 20px; }
    .hero {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 24px;
      box-shadow: 0 18px 40px rgba(23, 32, 51, 0.08);
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-top: 18px;
    }
    .metric {
      padding: 16px;
      border-radius: 16px;
      border: 1px solid var(--border);
      background: #fbfcff;
    }
    .metric strong {
      display: block;
      font-size: 28px;
      margin-bottom: 4px;
    }
    .runs {
      display: grid;
      gap: 16px;
    }
    .run {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 18px 40px rgba(23, 32, 51, 0.05);
    }
    .run-header {
      padding: 18px 20px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      background: #fbfcff;
      border-bottom: 1px solid var(--border);
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 999px;
      font-weight: 600;
      font-size: 14px;
    }
    .status.passed { color: var(--pass); background: #e8f7ef; }
    .status.failed { color: var(--fail); background: #fff1ea; }
    .steps {
      display: grid;
      gap: 12px;
      padding: 20px;
    }
    .step {
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px;
      background: #fff;
    }
    .step-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      margin-bottom: 10px;
    }
    .step-status {
      font-weight: 700;
      text-transform: uppercase;
      font-size: 12px;
      letter-spacing: 0.06em;
    }
    .step-status.passed { color: var(--pass); }
    .step-status.failed { color: var(--fail); }
    .step-status.skipped { color: var(--skip); }
    .phase {
      display: inline-block;
      margin-bottom: 6px;
      color: var(--accent);
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .meta {
      display: grid;
      gap: 6px;
      margin-top: 10px;
      color: var(--muted);
      font-size: 14px;
    }
    .capture {
      margin-top: 14px;
    }
    .capture a {
      color: var(--accent);
      text-decoration: none;
      font-weight: 600;
    }
    .capture img {
      display: block;
      width: min(100%, 720px);
      margin-top: 12px;
      border-radius: 14px;
      border: 1px solid var(--border);
    }
    .error {
      margin-top: 10px;
      color: var(--fail);
      font-weight: 600;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div class="stack">
    <section class="hero">
      <h1>${escapeHtml(scenarioName)}</h1>
      <p style="margin-top: 8px; color: var(--muted);">Generated at ${escapeHtml(generatedAt)}</p>
      <div class="summary">
        <div class="metric"><strong>${summary.totalRuns}</strong><span>Total browser runs</span></div>
        <div class="metric"><strong>${summary.passedRuns}</strong><span>Passed runs</span></div>
        <div class="metric"><strong>${summary.failedRuns}</strong><span>Failed runs</span></div>
        <div class="metric"><strong>${summary.totalSteps}</strong><span>Total steps</span></div>
      </div>
    </section>
    <section class="runs">
      ${results.map((result) => renderRun(result)).join("\n")}
    </section>
  </div>
</body>
</html>`;
}

function renderRun(result: RunResult): string {
  const browser = `${result.browser.browserName}:${result.browser.browserVersion}`;
  const passedSteps = result.steps.filter((step) => step.status === "passed").length;

  return `<article class="run">
    <div class="run-header">
      <div>
        <h2>${escapeHtml(browser)}</h2>
        <p style="margin-top: 6px; color: var(--muted);">${escapeHtml(result.startedAt)} to ${escapeHtml(result.finishedAt)}</p>
      </div>
      <div style="text-align: right;">
        <span class="status ${result.status}">${escapeHtml(result.status)}</span>
        <p style="margin-top: 6px; color: var(--muted);">${passedSteps}/${result.steps.length} steps passed · ${result.duration}ms</p>
      </div>
    </div>
    <div class="steps">
      ${result.steps.map((step) => renderStep(step.step, step.index, step.status, step.duration, step.error, step.artifacts)).join("\n")}
    </div>
  </article>`;
}

function renderStep(
  step: Step,
  index: number,
  status: "passed" | "failed" | "skipped",
  duration: number,
  error?: string,
  artifacts?: RunResult["steps"][number]["artifacts"],
): string {
  return `<section class="step">
    <div class="step-head">
      <div>
        ${step.phase ? `<div class="phase">${escapeHtml(step.phase)}</div>` : ""}
        <h3>${escapeHtml(step.name || describeStep(step))}</h3>
      </div>
      <div style="text-align: right;">
        <div class="step-status ${status}">${escapeHtml(status)}</div>
        <div style="margin-top: 6px; color: var(--muted);">Step ${index + 1} · ${duration}ms</div>
      </div>
    </div>
    <div class="meta">
      <div>${escapeHtml(describeStep(step))}</div>
      ${step.note ? `<div>Note: ${escapeHtml(step.note)}</div>` : ""}
      ${artifacts?.pageUrl ? `<div>URL: ${escapeHtml(artifacts.pageUrl)}</div>` : ""}
      ${artifacts?.pageTitle ? `<div>Title: ${escapeHtml(artifacts.pageTitle)}</div>` : ""}
    </div>
    ${artifacts?.screenshotPath ? `<div class="capture"><a href="${escapeHtml(artifacts.screenshotPath)}">Open capture</a><img src="${escapeHtml(artifacts.screenshotPath)}" alt="${escapeHtml(step.name || step.action)} capture" /></div>` : ""}
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
  </section>`;
}

function describeStep(step: Step): string {
  const label = step.name || step.action;
  const parts = [label];

  if ("url" in step) {
    parts.push(step.url);
  }
  if ("selector" in step && step.selector) {
    parts.push(step.selector.css || step.selector.xpath || "");
  }
  if ("selectorKey" in step && step.selectorKey) {
    parts.push(`@${step.selectorKey}`);
  }
  if ("value" in step && step.value) {
    parts.push(`"${step.value}"`);
  }
  if ("expected" in step && step.expected) {
    parts.push(`=> ${step.expected}`);
  }

  return parts.filter(Boolean).join(" · ");
}

function createSummary(results: RunResult[]) {
  return {
    totalRuns: results.length,
    passedRuns: results.filter((result) => result.status === "passed").length,
    failedRuns: results.filter((result) => result.status === "failed").length,
    totalSteps: results.reduce((count, result) => count + result.steps.length, 0),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

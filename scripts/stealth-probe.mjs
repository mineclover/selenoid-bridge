// Probe: compares fingerprint values with stealth ON vs OFF against a running Selenoid.
// Usage: node scripts/stealth-probe.mjs [selenoidUrl]
import { WebDriverClient } from "../dist/runner/webdriver.js";

const SELENOID = process.argv[2] || "http://localhost:4444";
const BROWSER = { browserName: "chrome", browserVersion: "128.0" };

const PROBE_JS = `
  return {
    webdriver: navigator.webdriver,
    languages: navigator.languages,
    pluginsLength: navigator.plugins.length,
    hasChromeRuntime: !!(window.chrome && window.chrome.runtime),
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    appVersion: navigator.appVersion,
  };
`;

async function probe(stealth) {
  const client = new WebDriverClient(SELENOID, { requestTimeoutMs: 30000 });
  try {
    await client.createSession(BROWSER, undefined, stealth);
    await client.navigate("about:blank");
    const fp = await client.executeScript(PROBE_JS);
    return fp;
  } finally {
    await client.deleteSession().catch(() => {});
  }
}

const off = await probe(false);
const on = await probe(true);

const rows = [
  ["signal", "stealth=off", "stealth=on"],
  ["navigator.webdriver", String(off.webdriver), String(on.webdriver)],
  ["navigator.languages", JSON.stringify(off.languages), JSON.stringify(on.languages)],
  ["navigator.plugins.length", String(off.pluginsLength), String(on.pluginsLength)],
  ["window.chrome.runtime", String(off.hasChromeRuntime), String(on.hasChromeRuntime)],
  ["navigator.platform", off.platform, on.platform],
  ["UA contains HeadlessChrome", String(/HeadlessChrome/i.test(off.userAgent)), String(/HeadlessChrome/i.test(on.userAgent))],
];

const w = rows[0].map((_, i) => Math.max(...rows.map(r => String(r[i]).length)));
for (const r of rows) {
  console.log(r.map((c, i) => String(c).padEnd(w[i])).join("  "));
}

console.log("\nfull UA off:", off.userAgent);
console.log("full UA on :", on.userAgent);

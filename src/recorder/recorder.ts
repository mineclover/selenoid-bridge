import { execSync } from "node:child_process";
import { extractSelector, parseAttributes, type DomAttributes } from "./selector.js";
import { parseSnapshot, findElementByRef, type SnapshotElement } from "./snapshot.js";
import type { Scenario, Step, Selector } from "../scenario/types.js";

export interface RecordOptions {
  url: string;
  output?: string;
}

/**
 * Execute an agent-browser command and return stdout.
 */
function ab(cmd: string): string {
  try {
    return execSync(`agent-browser ${cmd}`, {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`agent-browser command failed: ${cmd}\n${msg}`);
  }
}

/**
 * Take a snapshot and return parsed elements.
 */
function takeSnapshot(): ReturnType<typeof parseSnapshot> {
  const output = ab("snapshot --json");
  return parseSnapshot(output);
}

/**
 * Use CDP to get DOM attributes for an element by its backendNodeId.
 * Calls agent-browser eval to run CDP commands via the existing browser session.
 */
function getDomAttributes(element: SnapshotElement): DomAttributes {
  if (!element.backendNodeId) {
    return { tagName: "", ...element.attributes };
  }

  // Use agent-browser eval to extract attributes via JavaScript
  const script = `
    (async () => {
      const {Runtime, DOM} = await window.__cdp__;
      const {node} = await DOM.describeNode({backendNodeId: ${element.backendNodeId}});
      const attrs = {};
      if (node.attributes) {
        for (let i = 0; i < node.attributes.length; i += 2) {
          attrs[node.attributes[i]] = node.attributes[i + 1];
        }
      }
      attrs.tagName = node.nodeName;
      return JSON.stringify(attrs);
    })()
  `;

  try {
    // Fallback: use agent-browser's getattribute for known attributes
    const attrs: DomAttributes = { tagName: "" };

    const testIdAttr = ab(`get attr ${element.ref} data-testid`).trim();
    if (testIdAttr && testIdAttr !== "null") attrs["data-testid"] = testIdAttr;

    const idAttr = ab(`get attr ${element.ref} id`).trim();
    if (idAttr && idAttr !== "null") attrs.id = idAttr;

    const ariaLabel = ab(`get attr ${element.ref} aria-label`).trim();
    if (ariaLabel && ariaLabel !== "null") attrs["aria-label"] = ariaLabel;

    const role = ab(`get attr ${element.ref} role`).trim();
    if (role && role !== "null") attrs.role = role;

    const name = ab(`get attr ${element.ref} name`).trim();
    if (name && name !== "null") attrs.name = name;

    const type = ab(`get attr ${element.ref} type`).trim();
    if (type && type !== "null") attrs.type = type;

    const placeholder = ab(`get attr ${element.ref} placeholder`).trim();
    if (placeholder && placeholder !== "null") attrs.placeholder = placeholder;

    return attrs;
  } catch {
    // If attribute extraction fails, return what we have from snapshot
    return { tagName: "", role: element.role, ...element.attributes };
  }
}

/**
 * Resolve a stable selector for a given @ref.
 */
export function resolveSelector(ref: string): Selector {
  const snapshot = takeSnapshot();
  const element = findElementByRef(snapshot, ref);

  if (!element) {
    throw new Error(`Element not found for ref: ${ref}`);
  }

  const domAttrs = getDomAttributes(element);
  return extractSelector(domAttrs, element.name || undefined);
}

/**
 * Build a scenario from a list of recorded actions.
 * Each action is a { command, args } pair from agent-browser commands.
 */
export function buildScenario(
  name: string,
  baseUrl: string,
  actions: Array<{ command: string; ref?: string; value?: string }>,
): Scenario {
  const steps: Step[] = [];

  for (const action of actions) {
    switch (action.command) {
      case "goto":
      case "navigate":
      case "open": {
        const url = action.value || "";
        steps.push({ action: "goto", url });
        break;
      }
      case "click": {
        if (!action.ref) break;
        const selector = resolveSelector(action.ref);
        steps.push({ action: "click", selector });
        break;
      }
      case "fill":
      case "type": {
        if (!action.ref || action.value === undefined) break;
        const selector = resolveSelector(action.ref);
        steps.push({ action: "fill", selector, value: action.value });
        break;
      }
      case "select": {
        if (!action.ref || action.value === undefined) break;
        const selector = resolveSelector(action.ref);
        steps.push({ action: "select", selector, value: action.value });
        break;
      }
      case "check": {
        if (!action.ref) break;
        const selector = resolveSelector(action.ref);
        steps.push({ action: "check", selector });
        break;
      }
      case "hover": {
        if (!action.ref) break;
        const selector = resolveSelector(action.ref);
        steps.push({ action: "hover", selector });
        break;
      }
      case "press": {
        steps.push({ action: "press", key: action.value || "" });
        break;
      }
      case "wait": {
        const ms = action.value ? parseInt(action.value, 10) : 1000;
        steps.push({ action: "wait", ms });
        break;
      }
    }
  }

  return {
    name,
    baseUrl,
    steps,
    metadata: {
      recordedAt: new Date().toISOString(),
      recordedWith: "selenoid-bridge",
    },
  };
}

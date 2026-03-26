import type { Scenario, Step } from "./types.js";

export function validateScenario(data: unknown): Scenario {
  if (!data || typeof data !== "object") {
    throw new Error("Scenario must be an object");
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.name !== "string" || !obj.name) {
    throw new Error("Scenario must have a name");
  }
  if (typeof obj.baseUrl !== "string" || !obj.baseUrl) {
    throw new Error("Scenario must have a baseUrl");
  }
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    throw new Error("Scenario must have at least one step");
  }

  for (let i = 0; i < obj.steps.length; i++) {
    validateStep(obj.steps[i], i);
  }

  return data as Scenario;
}

function validateStep(step: unknown, index: number): void {
  if (!step || typeof step !== "object") {
    throw new Error(`Step ${index}: must be an object`);
  }

  const s = step as Record<string, unknown>;
  const validActions = ["goto", "click", "fill", "select", "check", "hover", "scroll", "press", "wait", "assert"];

  if (!validActions.includes(s.action as string)) {
    throw new Error(`Step ${index}: invalid action "${s.action}"`);
  }

  if (s.action === "goto" && typeof s.url !== "string") {
    throw new Error(`Step ${index}: goto requires url`);
  }
  if (s.action === "fill" && typeof s.value !== "string") {
    throw new Error(`Step ${index}: fill requires value`);
  }
  if (s.action === "assert" && !s.type) {
    throw new Error(`Step ${index}: assert requires type`);
  }
  if (["click", "fill", "select", "check", "hover"].includes(s.action as string) && !s.selector) {
    throw new Error(`Step ${index}: ${s.action} requires selector`);
  }
}

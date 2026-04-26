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
  if (obj.selectors !== undefined) {
    validateSelectors(obj.selectors);
  }
  if (obj.journey !== undefined) {
    validateJourney(obj.journey);
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
  const validActions = ["goto", "click", "fill", "select", "check", "hover", "scroll", "press", "wait", "assert", "record", "measure"];

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
  if (s.action === "scroll") {
    const hasSelector = Boolean(s.selector) || (typeof s.selectorKey === "string" && Boolean(s.selectorKey));
    if (!hasSelector && typeof s.direction !== "string") {
      throw new Error(`Step ${index}: scroll requires selector, selectorKey, or direction`);
    }
    if (s.direction !== undefined && !["up", "down"].includes(s.direction as string)) {
      throw new Error(`Step ${index}: scroll direction must be up or down`);
    }
    if (s.amount !== undefined && (typeof s.amount !== "number" || s.amount <= 0)) {
      throw new Error(`Step ${index}: scroll amount must be a positive number`);
    }
  }
  if (["click", "fill", "select", "check", "hover"].includes(s.action as string) && !s.selector) {
    if (typeof s.selectorKey !== "string" || !s.selectorKey) {
      throw new Error(`Step ${index}: ${s.action} requires selector or selectorKey`);
    }
  }
  if (s.name !== undefined && typeof s.name !== "string") {
    throw new Error(`Step ${index}: name must be a string`);
  }
  if (s.phase !== undefined && typeof s.phase !== "string") {
    throw new Error(`Step ${index}: phase must be a string`);
  }
  if (s.capture !== undefined && !["always", "failure", "off"].includes(s.capture as string)) {
    throw new Error(`Step ${index}: capture must be one of always, failure, off`);
  }
  if (s.selectorKey !== undefined && typeof s.selectorKey !== "string") {
    throw new Error(`Step ${index}: selectorKey must be a string`);
  }
  if (
    s.action === "assert" &&
    ["visible", "hidden", "text", "value"].includes(s.type as string) &&
    !s.selector &&
    (typeof s.selectorKey !== "string" || !s.selectorKey)
  ) {
    throw new Error(`Step ${index}: assert ${s.type} requires selector or selectorKey`);
  }
  if (s.action === "record") {
    if (s.mode !== "start" && s.mode !== "stop") {
      throw new Error(`Step ${index}: record requires mode "start" or "stop"`);
    }
  }
  if (s.action === "measure") {
    if (!s.selector && (typeof s.selectorKey !== "string" || !s.selectorKey)) {
      throw new Error(`Step ${index}: measure requires selector or selectorKey`);
    }
    if (s.event !== undefined && !["animationend", "transitionend"].includes(s.event as string)) {
      throw new Error(`Step ${index}: measure event must be animationend or transitionend`);
    }
  }
}

function validateJourney(journey: unknown): void {
  if (!journey || typeof journey !== "object") {
    throw new Error("Scenario journey must be an object");
  }

  const value = journey as Record<string, unknown>;
  if (value.actor !== undefined && typeof value.actor !== "string") {
    throw new Error("Scenario journey actor must be a string");
  }
  if (value.goal !== undefined && typeof value.goal !== "string") {
    throw new Error("Scenario journey goal must be a string");
  }
  if (value.phases !== undefined && (!Array.isArray(value.phases) || value.phases.some((phase) => typeof phase !== "string"))) {
    throw new Error("Scenario journey phases must be an array of strings");
  }
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string"))) {
    throw new Error("Scenario journey tags must be an array of strings");
  }
}

function validateSelectors(selectors: unknown): void {
  if (!selectors || typeof selectors !== "object" || Array.isArray(selectors)) {
    throw new Error("Scenario selectors must be an object");
  }

  for (const [key, value] of Object.entries(selectors as Record<string, unknown>)) {
    if (!value || typeof value !== "object") {
      throw new Error(`Scenario selector "${key}" must be an object`);
    }

    const selector = value as Record<string, unknown>;
    if (typeof selector.strategy !== "string") {
      throw new Error(`Scenario selector "${key}" must include strategy`);
    }
    if (typeof selector.css !== "string") {
      throw new Error(`Scenario selector "${key}" must include css`);
    }
  }
}

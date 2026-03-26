import { describe, it, expect } from "vitest";
import { validateScenario } from "../src/scenario/validate.js";

describe("validateScenario", () => {
  it("accepts valid scenario", () => {
    const scenario = validateScenario({
      name: "Login test",
      baseUrl: "https://example.com",
      steps: [
        { action: "goto", url: "/login" },
        { action: "fill", selector: { css: "#email", strategy: "id" }, value: "test@test.com" },
        { action: "click", selector: { css: "#submit", strategy: "id" } },
      ],
    });
    expect(scenario.name).toBe("Login test");
    expect(scenario.steps).toHaveLength(3);
  });

  it("rejects empty name", () => {
    expect(() =>
      validateScenario({ name: "", baseUrl: "https://example.com", steps: [{ action: "goto", url: "/" }] }),
    ).toThrow("must have a name");
  });

  it("rejects empty steps", () => {
    expect(() =>
      validateScenario({ name: "Test", baseUrl: "https://example.com", steps: [] }),
    ).toThrow("at least one step");
  });

  it("rejects invalid action", () => {
    expect(() =>
      validateScenario({ name: "Test", baseUrl: "https://x.com", steps: [{ action: "fly" }] }),
    ).toThrow('invalid action');
  });

  it("rejects fill without value", () => {
    expect(() =>
      validateScenario({
        name: "Test",
        baseUrl: "https://x.com",
        steps: [{ action: "fill", selector: { css: "#x", strategy: "id" } }],
      }),
    ).toThrow("fill requires value");
  });

  it("rejects click without selector", () => {
    expect(() =>
      validateScenario({
        name: "Test",
        baseUrl: "https://x.com",
        steps: [{ action: "click" }],
      }),
    ).toThrow("click requires selector");
  });

  it("accepts assert with type and expected", () => {
    const scenario = validateScenario({
      name: "Test",
      baseUrl: "https://x.com",
      steps: [{ action: "assert", type: "title", expected: "Home" }],
    });
    expect(scenario.steps[0].action).toBe("assert");
  });
});

import { describe, it, expect } from "vitest";
import { createScenarioTemplate } from "../src/scenario/templates.js";
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

  it("accepts journey metadata and step capture settings", () => {
    const scenario = validateScenario({
      name: "Checkout flow",
      baseUrl: "https://shop.example.com",
      selectors: {
        "auth.signup.form": {
          css: "[data-testid='auth.signup.form']",
          strategy: "data-testid",
        },
      },
      journey: {
        actor: "guest",
        goal: "결제 완료",
        phases: ["회원 가입", "결제"],
        tags: ["checkout"],
      },
      steps: [
        {
          id: "signup-page",
          phase: "회원 가입",
          name: "회원 가입 화면이 보인다",
          action: "goto",
          url: "/signup",
          capture: "always",
        },
        {
          id: "signup-form-visible",
          phase: "회원 가입",
          name: "회원 가입 폼이 보인다",
          action: "assert",
          type: "visible",
          selectorKey: "auth.signup.form",
          capture: "always",
        },
      ],
    });

    expect(scenario.journey?.goal).toBe("결제 완료");
    expect(scenario.steps[0].capture).toBe("always");
    expect(scenario.selectors?.["auth.signup.form"]?.css).toContain("auth.signup.form");
  });

  it("rejects invalid capture mode", () => {
    expect(() =>
      validateScenario({
        name: "Test",
        baseUrl: "https://x.com",
        steps: [{ action: "goto", url: "/", capture: "sometimes" }],
      }),
    ).toThrow("capture must be one of always, failure, off");
  });
});

describe("createScenarioTemplate", () => {
  it("creates a commerce checkout template", () => {
    const scenario = createScenarioTemplate("Checkout", "https://shop.example.com", "commerce-checkout");

    expect(scenario.journey?.phases).toContain("결제");
    expect(scenario.steps.some((step) => step.phase === "결제 진행 확인")).toBe(true);
    expect(scenario.steps.every((step) => step.capture === "failure")).toBe(true);
    expect(scenario.selectors?.["checkout.submit"]?.css).toContain("checkout.submit");
    expect(scenario.steps.some((step) => step.selectorKey === "checkout.submit")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { extractSelector, parseAttributes } from "../src/recorder/selector.js";

describe("extractSelector", () => {
  it("prefers data-testid", () => {
    const sel = extractSelector({ tagName: "button", "data-testid": "submit-btn", id: "btn1" });
    expect(sel.strategy).toBe("data-testid");
    expect(sel.css).toBe("[data-testid='submit-btn']");
  });

  it("uses id when no data-testid", () => {
    const sel = extractSelector({ tagName: "div", id: "main-content" });
    expect(sel.strategy).toBe("id");
    expect(sel.css).toBe("#main-content");
  });

  it("skips auto-generated ids", () => {
    const sel = extractSelector({ tagName: "div", id: ":r0:", "aria-label": "Menu" });
    expect(sel.strategy).toBe("aria-label");
  });

  it("skips UUID ids", () => {
    const sel = extractSelector({ tagName: "div", id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", "aria-label": "Panel" });
    expect(sel.strategy).toBe("aria-label");
  });

  it("uses aria-label when no id", () => {
    const sel = extractSelector({ tagName: "button", "aria-label": "Close dialog" });
    expect(sel.strategy).toBe("aria-label");
    expect(sel.css).toBe("[aria-label='Close dialog']");
  });

  it("uses role+name when only role attribute exists", () => {
    const sel = extractSelector({ tagName: "button", role: "button" }, "Submit");
    expect(sel.strategy).toBe("role-name");
    expect(sel.xpath).toContain("role='button'");
    expect(sel.xpath).toContain("Submit");
  });

  it("falls back to text when only ariaName exists", () => {
    const sel = extractSelector({ tagName: "span" }, "Click here");
    expect(sel.strategy).toBe("text");
    expect(sel.xpath).toContain("Click here");
  });

  it("falls back to css-path as last resort", () => {
    const sel = extractSelector({ tagName: "input", type: "email", placeholder: "Enter email" });
    expect(sel.strategy).toBe("css-path");
    expect(sel.css).toContain("input");
    expect(sel.css).toContain("[type='email']");
    expect(sel.css).toContain("[placeholder='Enter email']");
  });
});

describe("parseAttributes", () => {
  it("parses flat attribute array", () => {
    const attrs = parseAttributes(["data-testid", "login", "id", "form", "class", "container"]);
    expect(attrs["data-testid"]).toBe("login");
    expect(attrs.id).toBe("form");
    expect(attrs.class).toBe("container");
  });

  it("handles empty array", () => {
    const attrs = parseAttributes([]);
    expect(attrs.tagName).toBe("");
  });
});

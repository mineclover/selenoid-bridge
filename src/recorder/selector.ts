import type { Selector } from "../scenario/types.js";

export interface DomAttributes {
  tagName: string;
  id?: string;
  "data-testid"?: string;
  "aria-label"?: string;
  role?: string;
  name?: string;
  type?: string;
  placeholder?: string;
  [key: string]: string | undefined;
}

export function extractSelector(attrs: DomAttributes, ariaName?: string): Selector {
  // Priority 1: data-testid
  if (attrs["data-testid"]) {
    return {
      css: `[data-testid='${escCss(attrs["data-testid"])}']`,
      strategy: "data-testid",
    };
  }

  // Priority 2: id (if it looks stable — not auto-generated)
  if (attrs.id && isStableId(attrs.id)) {
    return {
      css: `#${escCss(attrs.id)}`,
      strategy: "id",
    };
  }

  // Priority 3: aria-label
  if (attrs["aria-label"]) {
    return {
      css: `[aria-label='${escCss(attrs["aria-label"])}']`,
      strategy: "aria-label",
    };
  }

  // Priority 4: role + name from accessibility tree
  if (attrs.role && ariaName) {
    return {
      css: `[role='${escCss(attrs.role)}']`,
      xpath: `//*[@role='${attrs.role}' and normalize-space()='${ariaName}']`,
      strategy: "role-name",
    };
  }

  // Priority 5: text content (via ariaName)
  if (ariaName) {
    return {
      css: "",
      xpath: `//*[normalize-space()='${ariaName}']`,
      strategy: "text",
    };
  }

  // Priority 6: CSS path fallback
  const tag = attrs.tagName?.toLowerCase() || "*";
  const parts = [tag];
  if (attrs.type) parts.push(`[type='${escCss(attrs.type)}']`);
  if (attrs.name) parts.push(`[name='${escCss(attrs.name)}']`);
  if (attrs.placeholder) parts.push(`[placeholder='${escCss(attrs.placeholder)}']`);

  return {
    css: parts.join(""),
    strategy: "css-path",
  };
}

function isStableId(id: string): boolean {
  // Skip auto-generated IDs (e.g., ":r0:", "react-123", "ember456", random UUIDs)
  if (/^:r\d+:$/.test(id)) return false;
  if (/^[a-f0-9-]{36}$/.test(id)) return false;
  if (/^\d+$/.test(id)) return false;
  if (id.length > 50) return false;
  return true;
}

function escCss(value: string): string {
  return value.replace(/'/g, "\\'").replace(/\\/g, "\\\\");
}

export function parseAttributes(flatAttrs: string[]): DomAttributes {
  const attrs: DomAttributes = { tagName: "" };
  for (let i = 0; i < flatAttrs.length; i += 2) {
    const key = flatAttrs[i];
    const value = flatAttrs[i + 1];
    if (key && value !== undefined) {
      attrs[key] = value;
    }
  }
  return attrs;
}

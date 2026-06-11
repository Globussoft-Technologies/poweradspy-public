import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const html = require("../../../../src/services/sdui/admin/adminHtml");

describe("sdui/admin/adminHtml", () => {
  it("exports a non-empty string", () => {
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(1000);
  });
  it("is a full HTML document", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.endsWith("</html>")).toBe(true);
  });
  it("contains expected SDUI admin markers", () => {
    expect(html).toContain("SDUI Admin");
    expect(html).toContain("/api/admin/sdui-login");
  });
});

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { LANG_ISO_TO_ES } = require("../../../../src/services/tiktok/helpers/languages");

describe("services/tiktok/helpers/languages", () => {
  it("exports the LANG_ISO_TO_ES map with expected core entries", () => {
    expect(LANG_ISO_TO_ES.en).toBe("english");
    expect(LANG_ISO_TO_ES.es).toBe("spanish");
    expect(LANG_ISO_TO_ES.zh).toBe("chinese");
    expect(LANG_ISO_TO_ES["zh-cn"]).toBe("chinese simplified");
    expect(LANG_ISO_TO_ES["zh-tw"]).toBe("chinese traditional");
  });

  it("map covers a wide ISO range (>= 100 entries)", () => {
    expect(Object.keys(LANG_ISO_TO_ES).length).toBeGreaterThanOrEqual(100);
  });

  it("all values are non-empty lowercase strings", () => {
    for (const v of Object.values(LANG_ISO_TO_ES)) {
      expect(typeof v).toBe("string");
      expect(v.length).toBeGreaterThan(0);
      expect(v).toBe(v.toLowerCase());
    }
  });
});

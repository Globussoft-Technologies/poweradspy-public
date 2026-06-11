import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { COUNTRY_LABEL_TO_ISO } = require("../../../../src/services/tiktok/helpers/countries");

describe("services/tiktok/helpers/countries > COUNTRY_LABEL_TO_ISO", () => {
  it("exports a plain object", () => {
    expect(typeof COUNTRY_LABEL_TO_ISO).toBe("object");
    expect(COUNTRY_LABEL_TO_ISO).not.toBeNull();
  });

  it("maps a known set of countries to ISO-2 codes", () => {
    expect(COUNTRY_LABEL_TO_ISO["United States"]).toBe("US");
    expect(COUNTRY_LABEL_TO_ISO["United Kingdom"]).toBe("GB");
    expect(COUNTRY_LABEL_TO_ISO["India"]).toBe("IN");
    expect(COUNTRY_LABEL_TO_ISO["Brazil"]).toBe("BR");
    expect(COUNTRY_LABEL_TO_ISO["Japan"]).toBe("JP");
    expect(COUNTRY_LABEL_TO_ISO["Germany"]).toBe("DE");
    expect(COUNTRY_LABEL_TO_ISO["Afghanistan"]).toBe("AF");
    expect(COUNTRY_LABEL_TO_ISO["Zimbabwe"]).toBe("ZW");
  });

  it("every value is a 2-letter uppercase ISO code", () => {
    for (const [label, code] of Object.entries(COUNTRY_LABEL_TO_ISO)) {
      expect(typeof code).toBe("string");
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("every code is unique (no two countries share an ISO)", () => {
    const codes = Object.values(COUNTRY_LABEL_TO_ISO);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it("contains a non-trivial number of countries", () => {
    expect(Object.keys(COUNTRY_LABEL_TO_ISO).length).toBeGreaterThan(50);
  });

  it("unknown labels return undefined", () => {
    expect(COUNTRY_LABEL_TO_ISO["Atlantis"]).toBeUndefined();
    expect(COUNTRY_LABEL_TO_ISO["unknown"]).toBeUndefined();
  });
});

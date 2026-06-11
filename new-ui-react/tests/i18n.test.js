import { describe, it, expect } from "vitest";
import i18n from "../src/i18n.js";

describe("i18n bootstrap", () => {
  it("initializes with the 4 expected resource bundles", () => {
    const resources = i18n.options.resources;
    expect(resources.en).toBeDefined();
    expect(resources.ar).toBeDefined();
    expect(resources.fr).toBeDefined();
    expect(resources.pt).toBeDefined();
  });
  it("fallbackLng is 'en'", () => {
    // i18next normalizes fallbackLng to an array
    const fb = i18n.options.fallbackLng;
    expect(Array.isArray(fb) ? fb[0] : fb).toBe("en");
  });
  it("interpolation.escapeValue is false (React handles escaping)", () => {
    expect(i18n.options.interpolation.escapeValue).toBe(false);
  });
  it("detection.lookupLocalStorage is pas_language", () => {
    expect(i18n.options.detection.lookupLocalStorage).toBe("pas_language");
  });
  it("default export has t() and changeLanguage()", () => {
    expect(typeof i18n.t).toBe("function");
    expect(typeof i18n.changeLanguage).toBe("function");
  });
});

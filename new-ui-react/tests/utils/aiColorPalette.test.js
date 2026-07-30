import { describe, expect, it } from "vitest";
import {
  getAiColorLabel,
  normalizeAiColorHex,
} from "../../src/utils/aiColorPalette";

describe("AI color palette presentation", () => {
  it("converts a stored hex value into a human-readable fallback label", () => {
    expect(getAiColorLabel("#E03131", "#E03131")).toBe("Red");
  });

  it("keeps a descriptive SDUI label authoritative", () => {
    expect(getAiColorLabel("#1971C2", "Ocean Blue")).toBe("Ocean Blue");
  });

  it("normalizes hex case without changing the backend-facing vocabulary", () => {
    expect(normalizeAiColorHex("#e8d8b0")).toBe("#E8D8B0");
    expect(getAiColorLabel("#e8d8b0")).toBe("Beige");
  });

  it("leaves unknown non-hex values readable", () => {
    expect(getAiColorLabel("custom-color")).toBe("custom-color");
  });
});


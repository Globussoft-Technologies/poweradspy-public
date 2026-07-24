import { describe, expect, it } from "vitest";
import {
  getAspectStyle,
  normalizePlatformSlug,
} from "../../../src/components/modals/AnalyticsModal.jsx";

describe("AnalyticsModal platform normalization", () => {
  it("accepts numeric platform 18 without calling string methods on it", () => {
    expect(normalizePlatformSlug(18)).toBe("google");
    expect(() => getAspectStyle(18, "FEED")).not.toThrow();
    expect(getAspectStyle(18, "FEED")).toEqual({});
  });

  it("preserves legacy string platforms", () => {
    expect(normalizePlatformSlug("Instagram")).toBe("instagram");
    expect(getAspectStyle("youtube", "feed")).toEqual({ aspectRatio: "16/9" });
  });
});

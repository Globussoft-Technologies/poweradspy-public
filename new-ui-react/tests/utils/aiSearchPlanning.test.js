import { describe, expect, it } from "vitest";
import {
  formatPlanningUnsupportedMessage,
  getPlanningQuickFilterId,
  getPlanningUnsupported,
  hasExecutableMappedSearch,
} from "../../src/utils/aiSearchPlanning";

describe("AI search planning helpers", () => {
  it("returns the planner unsupported entries without rewriting them", () => {
    const unsupported = [{ operation: "sort", field: "view", reason: "Views are unavailable" }];
    const planning = { unsupported, consumed_phrases: ["highest views"] };

    expect(getPlanningUnsupported(planning)).toBe(unsupported);
    expect(formatPlanningUnsupportedMessage(unsupported)).toBe("Views are unavailable.");
  });

  it("distinguishes an explicit preset from no preset", () => {
    expect(getPlanningQuickFilterId({ quick_filter: "app_install" })).toBe("app_install");
    expect(getPlanningQuickFilterId({ quick_filter: "" })).toBeNull();
    expect(getPlanningQuickFilterId({})).toBeNull();
  });

  it("does not treat platform-only or unsupported-only plans as executable", () => {
    expect(hasExecutableMappedSearch({ activePlatforms: ["facebook"], filterValues: {} })).toBe(false);
    expect(hasExecutableMappedSearch({ filterValues: {}, sortBy: null })).toBe(false);
    expect(hasExecutableMappedSearch({ filterValues: { has_ai_meta: true } })).toBe(false);
    expect(hasExecutableMappedSearch({ filterValues: { likes: [500, 2000] } })).toBe(true);
    expect(hasExecutableMappedSearch({ searchQuery: "shoe", filterValues: {} })).toBe(true);
    expect(hasExecutableMappedSearch({ filterValues: {}, sortBy: "impressions" })).toBe(true);
  });
});

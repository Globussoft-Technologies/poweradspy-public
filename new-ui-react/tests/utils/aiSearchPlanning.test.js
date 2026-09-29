import { describe, expect, it } from "vitest";
import {
  formatPlanningUnsupportedMessage,
  findNextExecutablePlanningTier,
  getPlanningNotices,
  getPlanningQuickFilterId,
  getPlanningSummary,
  getPlanningSuggestions,
  getPlanningUnsupported,
  hasExplicitPlanningSubject,
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

  it("normalizes and caps planner Did you mean suggestions", () => {
    expect(getPlanningSuggestions({
      suggestions: [
        { prompt: "  Show shoe ads  ", kind: "exact" },
        { prompt: "Show ads from India", kind: "broader" },
        { prompt: "Show ads", kind: "broadest" },
        { prompt: "ignored fourth suggestion", kind: "exact" },
        { prompt: "   ", kind: "exact" },
        null,
      ],
    })).toEqual([
      { prompt: "Show shoe ads", kind: "exact" },
      { prompt: "Show ads from India", kind: "broader" },
      { prompt: "Show ads", kind: "broadest" },
    ]);
    expect(getPlanningSuggestions({ suggestions: [] })).toEqual([]);
    expect(getPlanningSuggestions({})).toEqual([]);
  });

  it("resolves the selected tier summary and displayable notices", () => {
    const planning = {
      summary: "Facebook ads - Category: Footwear",
      notices: [{ kind: "scope", message: " Searched Facebook only " }],
      tiers: [
        { summary: "Facebook ads - Category: Footwear" },
        { summary: "Facebook ads - Keyword: shoes" },
      ],
    };

    expect(getPlanningSummary(planning, 1)).toBe("Facebook ads - Keyword: shoes");
    expect(getPlanningNotices(planning)).toEqual([
      { kind: "scope", message: "Searched Facebook only" },
    ]);
  });

  it("falls back to response-level planning metadata", () => {
    expect(getPlanningSummary(
      { tiers: [] },
      0,
      { summary: "Facebook ads - Country: India" },
    )).toBe("Facebook ads - Country: India");
    expect(getPlanningNotices(
      { tiers: [] },
      { notices: [{ kind: "choice", message: " Selected Taboola " }] },
    )).toEqual([{ kind: "choice", message: "Selected Taboola" }]);
  });

  it("does not treat platform-only or unsupported-only plans as executable", () => {
    expect(hasExecutableMappedSearch({ activePlatforms: ["facebook"], filterValues: {} })).toBe(false);
    expect(hasExecutableMappedSearch({ filterValues: {}, sortBy: null })).toBe(false);
    expect(hasExecutableMappedSearch({ filterValues: { has_ai_meta: true } })).toBe(false);
    expect(hasExecutableMappedSearch({ filterValues: { likes: [500, 2000] } })).toBe(true);
    expect(hasExecutableMappedSearch({ searchQuery: "shoe", filterValues: {} })).toBe(true);
    expect(hasExecutableMappedSearch({ filterValues: {}, sortBy: "impressions" })).toBe(true);
  });

  it("requires a subject-like value when DS declares a subject role", () => {
    const planning = { search_term_role: "subject" };

    expect(hasExplicitPlanningSubject(planning, { keyword: "weight loss" }, {})).toBe(true);
    expect(hasExplicitPlanningSubject(planning, { ai_intent: ["app_install"] }, {})).toBe(true);
    expect(hasExplicitPlanningSubject(planning, {}, { searchQuery: "NA" })).toBe(false);
    expect(hasExplicitPlanningSubject(planning, { network: ["facebook"], type: ["VIDEO"] }, {})).toBe(false);
    expect(hasExplicitPlanningSubject({ search_term_role: "instruction" }, { network: ["facebook"] }, {})).toBe(true);
  });

  it("finds the next executable fallback tier and skips unmapped tiers", () => {
    const tiers = [
      { hasExecutableSearch: true, mapped: { filterValues: { colors: ["red"] } } },
      { hasExecutableSearch: true, mapped: { unmappedDetails: [{ field: "unknown" }] } },
      { hasExecutableSearch: true, mapped: { filterValues: { hook: ["urgency"] } } },
    ];

    expect(findNextExecutablePlanningTier(tiers, 0)).toMatchObject({ index: 2 });
    expect(findNextExecutablePlanningTier(tiers, 2)).toBeNull();
  });
});

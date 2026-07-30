import { describe, expect, it } from "vitest";
import {
  findActiveAiQuickFilterPreset,
  hasActiveAiFilters,
  replaceAiFilters,
  resolveAiQuickFilterPresets,
} from "../../src/utils/aiQuickFilterPresets";

const makeDoc = () => ({
  _id: "ai_meta",
  filters: [
    {
      _id: "ai_ad_type",
      options: [
        { value: "ugc" },
        { value: "explainer" },
        { value: "promotional" },
        { value: "lifestyle" },
        { value: "demonstration" },
        { value: "testimonial" },
        { value: "before_after" },
      ],
    },
    {
      _id: "ai_intent",
      options: [
        { value: "engagement" },
        { value: "lead_generation" },
        { value: "conversion" },
        { value: "awareness" },
        { value: "app_install" },
        { value: "retargeting" },
      ],
    },
    {
      _id: "ai_hook",
      options: [
        { value: "curiosity" },
        { value: "social_proof" },
        { value: "authority" },
        { value: "scarcity" },
        { value: "urgency" },
        { value: "discount" },
        { value: "aspiration" },
        { value: "transformation" },
        { value: "novelty" },
        { value: "convenience" },
        { value: "fomo" },
      ],
    },
    {
      _id: "ai_offering_type",
      options: [{ value: "product" }, { value: "service" }],
    },
    {
      _id: "ai_offer_type",
      options: [
        { value: "demo" },
        { value: "limited_time_offer" },
        { value: "percentage_discount" },
        { value: "flat_discount" },
        { value: "coupon" },
        { value: "consultation" },
        { value: "financing" },
      ],
    },
    {
      _id: "ai_colors",
      options: [
        "#000000",
        "#FFFFFF",
        "#E03131",
        "#F76707",
        "#F2CC0C",
        "#2F9E44",
        "#0CA678",
        "#1971C2",
        "#1E3A5F",
        "#7048E8",
        "#E64980",
        "#C9A227",
        "#E8D8B0",
      ].map((value) => ({ value })),
    },
    {
      _id: "ai_category_id",
      parent_filter_id: "ai_category_id",
      child_filter_id: "ai_subcategory_id",
      options: [
        "1009",
        "1010",
        "1021",
        "1025",
        "1026",
        "1027",
        "1036",
      ].map((value) => ({ value })),
    },
  ],
});

describe("AI quick filter presets", () => {
  it("resolves every preset against options available in the SDUI document", () => {
    const presets = resolveAiQuickFilterPresets(makeDoc());

    expect(presets).toHaveLength(8);
    expect(presets.find((preset) => preset.id === "flash_sale")?.filters).toEqual(
      {
        ai_hook: ["scarcity", "urgency", "discount"],
      },
    );
    expect(
      presets.every((preset) => Object.keys(preset.filters).length === 1),
    ).toBe(true);
  });

  it("hides an incomplete preset instead of sending unsupported query values", () => {
    const doc = makeDoc();
    const hookFilter = doc.filters.find((filter) => filter._id === "ai_hook");
    hookFilter.options = hookFilter.options.filter(
      (option) => option.value !== "urgency",
    );

    const flashSale = resolveAiQuickFilterPresets(doc).find(
      (preset) => preset.id === "flash_sale",
    );

    expect(flashSale).toBeUndefined();
  });

  it("replaces only AI values and preserves unrelated filters", () => {
    const doc = makeDoc();
    const flashSale = resolveAiQuickFilterPresets(doc).find(
      (preset) => preset.id === "flash_sale",
    );
    const next = replaceAiFilters(
      {
        country_filter: ["US"],
        engagement_likes: [100, 1000],
        ai_ad_type: ["testimonial"],
        ai_hook: ["social_proof"],
      },
      doc,
      flashSale.filters,
    );

    expect(next.country_filter).toEqual(["US"]);
    expect(next.engagement_likes).toEqual([100, 1000]);
    expect(next).not.toHaveProperty("ai_ad_type");
    expect(next.ai_hook).toEqual(["scarcity", "urgency", "discount"]);
  });

  it("recognizes a preset regardless of selected-value ordering", () => {
    const doc = makeDoc();
    const preset = resolveAiQuickFilterPresets(doc).find(
      (item) => item.id === "black_friday",
    );
    const values = {
      ai_offer_type: [...preset.filters.ai_offer_type].reverse(),
    };

    expect(findActiveAiQuickFilterPreset(values, doc)?.id).toBe("black_friday");
  });

  it("replaces the previous strategy instead of combining filter groups", () => {
    const doc = makeDoc();
    const presets = resolveAiQuickFilterPresets(doc);
    const flashSale = presets.find((preset) => preset.id === "flash_sale");
    const b2bSaas = presets.find((preset) => preset.id === "b2b_saas");
    const next = replaceAiFilters(
      { country_filter: ["US"], ...flashSale.filters },
      doc,
      b2bSaas.filters,
    );

    expect(next).toEqual({
      country_filter: ["US"],
      ai_category_id: ["1009"],
    });
  });

  it("clears every configured AI key while retaining normal filters", () => {
    const doc = makeDoc();
    const next = replaceAiFilters(
      {
        language_filter: ["en"],
        ai_ad_type: ["ugc"],
        ai_colors: ["#E64980"],
      },
      doc,
      {},
    );

    expect(next).toEqual({ language_filter: ["en"] });
    expect(hasActiveAiFilters(next, doc)).toBe(false);
  });
});

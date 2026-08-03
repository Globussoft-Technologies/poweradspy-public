import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiQuickFilters from "../../../src/components/ads/AiQuickFilters";
import { fetchAdsPresence } from "../../../src/services/api";

vi.mock("../../../src/services/api", async () => {
  const actual = await vi.importActual("../../../src/services/api");
  return {
    ...actual,
    fetchAdsPresence: vi.fn(async () => ({ hasAds: true })),
  };
});

const doc = {
  _id: "ai_meta",
  title: "AI SIGNALS",
  visible: true,
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
        {
          value: "1009",
          children: [
            { value: "10090001" },
            { value: "10090002" },
          ],
        },
        {
          value: "1010",
          children: [
            { value: "10100001" },
            { value: "10100002" },
          ],
        },
        {
          value: "1021",
          children: [{ value: "10210001" }],
        },
        { value: "1025", children: [{ value: "10250001" }] },
        { value: "1026", children: [{ value: "10260001" }] },
        { value: "1027", children: [{ value: "10270001" }] },
        { value: "1036", children: [{ value: "10360001" }] },
      ],
    },
  ],
};

describe("AiQuickFilters", () => {
  beforeEach(() => {
    fetchAdsPresence.mockReset();
    fetchAdsPresence.mockImplementation(async () => ({ hasAds: true }));
  });

  it("applies a strategy through the shared filter state", async () => {
    const onApply = vi.fn();
    render(
      <AiQuickFilters
        document={doc}
        filterValues={{ country_filter: ["US"] }}
        onApply={onApply}
      />,
    );

    await waitFor(() => expect(fetchAdsPresence).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /B2B SaaS/i }));

    expect(onApply).toHaveBeenCalledWith({
      country_filter: ["US"],
      ai_category_id: ["1009"],
      ai_subcategory_id: ["10090001", "10090002"],
    });
  });

  it("shows the matching strategy as selected", async () => {
    render(
      <AiQuickFilters
        document={doc}
        filterValues={{
          ai_ad_type: ["ugc"],
        }}
      />,
    );

    await waitFor(() => expect(fetchAdsPresence).toHaveBeenCalled());
    expect(
      screen.getByRole("button", { name: /TikTok UGC/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("replaces the active strategy when another card is selected", async () => {
    const onApply = vi.fn();
    const { rerender } = render(
      <AiQuickFilters
        document={doc}
        filterValues={{}}
        onApply={onApply}
      />,
    );

    await waitFor(() => expect(fetchAdsPresence).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Flash Sale/i }));
    const flashValues = onApply.mock.calls[0][0];
    expect(flashValues).toEqual({
      ai_hook: ["scarcity", "urgency", "discount"],
    });

    rerender(
      <AiQuickFilters
        document={doc}
        filterValues={flashValues}
        onApply={onApply}
      />,
    );
    await waitFor(() => expect(fetchAdsPresence).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /B2B SaaS/i }));
    const replacementValues = onApply.mock.calls[1][0];
    expect(replacementValues).toEqual({
      ai_category_id: ["1009"],
      ai_subcategory_id: ["10090001", "10090002"],
    });

    rerender(
      <AiQuickFilters
        document={doc}
        filterValues={replacementValues}
        onApply={onApply}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Flash Sale/i }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: /B2B SaaS/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("hides presets that would return no ads", async () => {
    fetchAdsPresence.mockImplementation(async (filters) => ({
      hasAds: !(Array.isArray(filters.ai_hook) && filters.ai_hook.includes("scarcity")),
    }));

    render(
      <AiQuickFilters
        document={doc}
        filterValues={{}}
        onApply={vi.fn()}
      />,
    );

    await waitFor(() => expect(fetchAdsPresence).toHaveBeenCalled());

    expect(
      screen.queryByRole("button", { name: /Flash Sale/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /B2B SaaS/i }),
    ).toBeInTheDocument();
  });

  it("routes restricted strategy clicks to the upgrade handler", async () => {
    const onApply = vi.fn();
    const onRestricted = vi.fn();
    render(
      <AiQuickFilters
        document={doc}
        filterValues={{}}
        onApply={onApply}
        isRestricted
        onRestricted={onRestricted}
      />,
    );

    await waitFor(() => expect(fetchAdsPresence).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Flash Sale/i }));

    expect(onRestricted).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("resets AI filters without clearing normal filters", async () => {
    const onApply = vi.fn();
    render(
      <AiQuickFilters
        document={doc}
        filterValues={{
          country_filter: ["US"],
          ai_ad_type: ["ugc"],
        }}
        onApply={onApply}
      />,
    );

    await waitFor(() => expect(fetchAdsPresence).toHaveBeenCalled());
    fireEvent.click(screen.getByTitle("Clear all AI filters"));

    expect(onApply).toHaveBeenCalledWith({ country_filter: ["US"] });
  });
});

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiQuickFilters from "../../../src/components/ads/AiQuickFilters";
import { fetchAiQuickFilterAvailability } from "../../../src/services/api";

vi.mock("../../../src/services/api", async () => {
  const actual = await vi.importActual("../../../src/services/api");
  return {
    ...actual,
    fetchAiQuickFilterAvailability: vi.fn(async () => ({ availability: {} })),
  };
});

const allPresetsAvailable = {
  tiktok_ugc: true,
  b2b_saas: true,
  flash_sale: true,
  luxury_brand: true,
  app_install: true,
  black_friday: true,
  high_ticket: true,
  local_lead: true,
};

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
    fetchAiQuickFilterAvailability.mockReset();
    fetchAiQuickFilterAvailability.mockImplementation(async () => ({
      availability: allPresetsAvailable,
    }));
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

    await waitFor(() => expect(fetchAiQuickFilterAvailability).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /B2B SaaS/i }));

    expect(onApply).toHaveBeenCalledWith({
      country_filter: ["US"],
      ai_category_id: ["1009"],
      ai_subcategory_id: ["10090001", "10090002"],
    });
  });

  it("loads preset availability through a single batch API call", async () => {
    render(
      <AiQuickFilters
        document={doc}
        filterValues={{ country_filter: ["US"] }}
        activePlatforms={["facebook", "instagram"]}
        searchQuery="lead gen"
        searchIn="advertiser"
        exactSearch
        filterPlatformSupport={{ ai_ad_type: ["facebook"] }}
      />,
    );

    await waitFor(() => expect(fetchAiQuickFilterAvailability).toHaveBeenCalledTimes(1));
    const [payload] = fetchAiQuickFilterAvailability.mock.calls[0];
    expect(payload).toEqual({ presets: expect.any(Array) });
    expect(payload.presets).toHaveLength(8);
    expect(payload.presets.every((preset) => preset.id && preset.payload)).toBe(true);
    expect(payload.presets.every((preset) => (
      preset.payload.network.join(",") === "facebook,instagram" &&
      preset.payload.advertiser === "lead gen" &&
      preset.payload.exact_search === 1
    ))).toBe(true);
    expect(payload.presets.every((preset) => preset.payload.country === "NA")).toBe(true);
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

    await waitFor(() => expect(fetchAiQuickFilterAvailability).toHaveBeenCalledTimes(1));
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

    await waitFor(() => expect(fetchAiQuickFilterAvailability).toHaveBeenCalledTimes(1));
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
    expect(fetchAiQuickFilterAvailability).toHaveBeenCalledTimes(1);
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
    fetchAiQuickFilterAvailability.mockImplementation(async (payload) => ({
      availability: {
        flash_sale: !payload?.presets?.find((preset) => preset.id === "flash_sale")?.payload?.ai_hook?.includes("scarcity"),
        b2b_saas: true,
      },
    }));

    render(
      <AiQuickFilters
        document={doc}
        filterValues={{}}
        onApply={vi.fn()}
      />,
    );

    await waitFor(() => expect(fetchAiQuickFilterAvailability).toHaveBeenCalledTimes(1));

    expect(
      screen.queryByRole("button", { name: /Flash Sale/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /B2B SaaS/i }),
    ).toBeInTheDocument();
  });

  it("does not render unverified presets after an empty availability response", async () => {
    fetchAiQuickFilterAvailability.mockImplementation(async () => ({ availability: {} }));

    render(
      <AiQuickFilters
        document={doc}
        filterValues={{}}
        onApply={vi.fn()}
      />,
    );

    await waitFor(() => expect(fetchAiQuickFilterAvailability).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText(/AI strategy quick filters/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /TikTok UGC/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /B2B SaaS/i })).not.toBeInTheDocument();
  });

  it("loads Google presets after carrying a country filter across a network switch", async () => {
    fetchAiQuickFilterAvailability.mockImplementation(async (payload) => ({
      availability: payload.presets.some((preset) => preset.payload.country !== "NA")
        ? {}
        : allPresetsAvailable,
    }));

    const { rerender } = render(
      <AiQuickFilters
        document={doc}
        filterValues={{ country_filter: ["Thailand"] }}
        onApply={vi.fn()}
        activePlatforms={["facebook", "instagram"]}
      />,
    );

    await waitFor(() => expect(fetchAiQuickFilterAvailability).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("button", { name: /B2B SaaS/i }),
    ).toBeInTheDocument();

    rerender(
      <AiQuickFilters
        document={doc}
        filterValues={{ country_filter: ["Thailand"] }}
        onApply={vi.fn()}
        activePlatforms={["google"]}
      />,
    );

    await waitFor(() => expect(fetchAiQuickFilterAvailability).toHaveBeenCalledTimes(2));
    const googlePayload = fetchAiQuickFilterAvailability.mock.calls[1][0];
    expect(googlePayload.presets.every((preset) => (
      preset.payload.network.join(",") === "google" &&
      preset.payload.country === "NA"
    ))).toBe(true);
    expect(
      screen.getByRole("button", { name: /B2B SaaS/i }),
    ).toBeInTheDocument();
  });

  it("does not let a later country selection invalidate loaded Google presets", async () => {
    const googlePlatforms = ["google"];
    const onApply = vi.fn();
    const { rerender } = render(
      <AiQuickFilters
        document={doc}
        filterValues={{}}
        onApply={onApply}
        activePlatforms={googlePlatforms}
      />,
    );

    await waitFor(() => expect(fetchAiQuickFilterAvailability).toHaveBeenCalledTimes(1));

    rerender(
      <AiQuickFilters
        document={doc}
        filterValues={{ country_filter: ["Thailand"] }}
        onApply={onApply}
        activePlatforms={googlePlatforms}
      />,
    );

    expect(fetchAiQuickFilterAvailability).toHaveBeenCalledTimes(1);
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

    await waitFor(() => expect(fetchAiQuickFilterAvailability).not.toHaveBeenCalled());
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

    await waitFor(() => expect(fetchAiQuickFilterAvailability).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTitle("Clear all AI filters"));

    expect(onApply).toHaveBeenCalledWith({ country_filter: ["US"] });
  });
});

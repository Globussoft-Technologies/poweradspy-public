import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import TransparencyDelivery, {
  formatTransparencyRange,
  getOperatorMeaning,
  resolveTransparencyCountryName,
} from "../../../../src/components/modals/analytics/TransparencyDelivery.jsx";

describe("TransparencyDelivery", () => {
  it("formats Google estimate operators without inventing exact counts", () => {
    expect(formatTransparencyRange({ min: 0, max: 1000, operator: "range" }))
      .toBe("0 – 1K");
    expect(formatTransparencyRange({ min: 1000, max: null, operator: "over" }))
      .toBe("1K+");
    expect(formatTransparencyRange(null)).toBe("--");
    expect(getOperatorMeaning({ operator: "range" })).toBe("Bounded range");
    expect(getOperatorMeaning({ operator: "over" }))
      .toBe("Minimum threshold · continues above");
  });

  it("renders platform, readable dates, global and country ranges", () => {
    const { getByText, getAllByText, getAllByLabelText, getAllByRole, queryByText } = render(
      <TransparencyDelivery
        isLight
        subnetwork="search"
        impressions={{ min: 0, max: 1000, operator: "range" }}
        firstSeen="2025-12-12T00:00:00Z"
        lastSeen="2025-12-21T00:00:00Z"
        countryDetails={[{
          country: "Germany",
          country_code: "DE",
          first_seen: "2025-12-12T00:00:00Z",
          last_seen: "2025-12-21T00:00:00Z",
          times_shown: { min: 0, max: 1000, operator: "range" },
        }]}
      />,
    );

    expect(getByText("Transparency Delivery")).toBeInTheDocument();
    expect(getByText("SEARCH")).toBeInTheDocument();
    expect(getByText("1")).toBeInTheDocument();
    expect(getByText("Estimated impressions")).toBeInTheDocument();
    expect(getByText("Overall estimated impressions")).toBeInTheDocument();
    expect(getAllByText("From").length).toBeGreaterThanOrEqual(2);
    expect(getAllByText("To").length).toBeGreaterThanOrEqual(2);
    expect(getByText("Country activity")).toBeInTheDocument();
    expect(getByText("First seen")).toBeInTheDocument();
    expect(getByText("Last seen")).toBeInTheDocument();
    expect(getByText("Active for")).toBeInTheDocument();
    expect(getByText("10 days")).toBeInTheDocument();
    expect(getByText("Geographic delivery intensity")).toBeInTheDocument();
    expect(getAllByText("Germany")).toHaveLength(2);
    expect(getAllByText("0 – 1K").length).toBeGreaterThanOrEqual(1);
    expect(getAllByText(/12 Dec 2025/).length).toBeGreaterThanOrEqual(2);
    expect(getAllByText(/21 Dec 2025/).length).toBeGreaterThanOrEqual(2);
    expect(queryByText("Platform 18")).toBeNull();
    expect(getAllByLabelText("Explain this metric").length).toBeGreaterThanOrEqual(8);
    expect(getAllByRole("tooltip").some((tip) =>
      tip.textContent.includes("Google estimates that this ad appeared")
    )).toBe(true);
  });

  it("does not turn a last-seen-only observation into a reversed range", () => {
    const { getByText, queryByText } = render(
      <TransparencyDelivery
        isLight
        lastSeen="2026-07-26T00:00:00Z"
        countryDetails={[{
          country: "United States",
          country_code: "US",
          first_seen: null,
          last_seen: "2026-07-27T00:00:00Z",
          times_shown: null,
        }]}
      />,
    );

    expect(getByText("Until 27 Jul 2026")).toBeInTheDocument();
    expect(queryByText(/27 Jul 2026.*26 Jul 2026/)).toBeNull();
  });

  it("hides unavailable metrics and lets the remaining layout reflow", () => {
    const { container, queryByText } = render(
      <TransparencyDelivery isLight countryDetails={[]} />,
    );
    expect(container).not.toHaveTextContent("--");
    expect(queryByText("Platform")).toBeNull();
    expect(queryByText("Impressions")).toBeNull();
    expect(queryByText("Countries")).toBeNull();
    expect(queryByText("Activity Window")).toBeNull();
    expect(queryByText("Estimated impressions")).toBeNull();
    expect(queryByText("Country activity")).toBeNull();
    expect(queryByText("Geographic delivery intensity")).toBeNull();
  });

  it("shows full country names when the payload contains only an ISO code", () => {
    const { getAllByText, queryByText } = render(
      <TransparencyDelivery
        isLight
        countryDetails={[{
          country: "US",
          country_code: "US",
          first_seen: "2026-03-27T00:00:00Z",
          last_seen: "2026-07-22T00:00:00Z",
          times_shown: { min: 1000000, max: null, operator: "over" },
        }]}
      />,
    );

    expect(resolveTransparencyCountryName("US", "US")).toBe("United States");
    expect(resolveTransparencyCountryName(null, "DE")).toBe("Germany");
    expect(getAllByText("United States").length).toBeGreaterThanOrEqual(2);
    expect(queryByText(/^US$/)).toBeNull();
    expect(queryByText("Geographic delivery intensity")).toBeInTheDocument();
  });
});

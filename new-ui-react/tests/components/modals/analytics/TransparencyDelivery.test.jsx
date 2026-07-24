import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import TransparencyDelivery, {
  formatTransparencyRange,
  getOperatorMeaning,
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
      tip.textContent.includes("country_details[].times_shown")
    )).toBe(true);
  });

  it("uses -- for unavailable summary values", () => {
    const { getAllByText } = render(
      <TransparencyDelivery isLight countryDetails={[]} />,
    );
    expect(getAllByText("--").length).toBeGreaterThanOrEqual(4);
  });
});

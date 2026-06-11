import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  Calendar: () => <i data-testid="cal-ic" />,
  Activity: () => <i data-testid="act-ic" />,
  Globe: () => <i data-testid="globe-ic" />,
  Monitor: () => <i data-testid="mon-ic" />,
  MapPin: () => <i data-testid="map-ic" />,
  Hash: () => <i data-testid="hash-ic" />,
}));

import AdDetails from "../../../../src/components/modals/analytics/AdDetails.jsx";

describe("AdDetails", () => {
  it("renders the 'Ad details' heading", () => {
    const { getByText } = render(<AdDetails />);
    expect(getByText("Ad details")).toBeInTheDocument();
  });
  it("renders all 8 detail labels", () => {
    const { getByText } = render(<AdDetails />);
    [
      "First Seen", "Last Seen", "Post Date", "Ad Status",
      "Ad Language", "Domain Reg. Date", "Ad Type", "Ad Position",
    ].forEach((label) => expect(getByText(label)).toBeInTheDocument());
  });
  it("renders the source section", () => {
    const { getByText } = render(<AdDetails />);
    expect(getByText("Source")).toBeInTheDocument();
    expect(getByText("Facebook Ad Library / Meta Marketing API")).toBeInTheDocument();
  });
});

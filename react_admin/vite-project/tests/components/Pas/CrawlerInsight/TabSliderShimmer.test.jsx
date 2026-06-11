import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import TabSliderShimmer from "../../../../src/components/Pas/CrawlerInsight/TabSliderShimmer.jsx";

describe("TabSliderShimmer", () => {
  it("renders shimmer container with 6 tab placeholders", () => {
    const { container } = render(<TabSliderShimmer />);
    expect(container.querySelector(".tab-slider-container")).not.toBeNull();
    expect(container.querySelectorAll(".tab-button").length).toBe(6);
  });
  it("renders both left and right nav button placeholders", () => {
    const { container } = render(<TabSliderShimmer />);
    expect(container.querySelectorAll(".nav-button").length).toBe(2);
  });
});

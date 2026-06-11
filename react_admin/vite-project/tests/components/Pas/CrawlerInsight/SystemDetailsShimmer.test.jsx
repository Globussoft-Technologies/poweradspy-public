import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import SystemDetailsShimmer from "../../../../src/components/Pas/CrawlerInsight/SystemDetailsShimmer.jsx";

describe("SystemDetailsShimmer", () => {
  it("renders an outer animate-pulse container", () => {
    const { container } = render(<SystemDetailsShimmer />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });
  it("renders 8 table shimmer rows", () => {
    const { container } = render(<SystemDetailsShimmer />);
    // 8 rows in the "Table Shimmer" map
    const rows = container.querySelectorAll(".h-12.w-full.bg-gray-200");
    expect(rows.length).toBe(8);
  });
  it("renders 5 left-column detail shimmer items", () => {
    const { container } = render(<SystemDetailsShimmer />);
    // each left/right item is `.space-y-2` — total = 5 + 4 = 9
    expect(container.querySelectorAll(".space-y-2").length).toBe(9);
  });
});

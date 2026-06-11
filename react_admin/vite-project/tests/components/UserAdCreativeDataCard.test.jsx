import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import UserAdCreativeDataCard from "../../src/components/UserAdCreativeDataCard.jsx";

describe("UserAdCreativeDataCard", () => {
  it("returns null when no data prop", () => {
    const { container } = render(<UserAdCreativeDataCard />);
    expect(container.innerHTML).toBe("");
  });
  it("returns null when adCreativeSide is empty", () => {
    const { container } = render(<UserAdCreativeDataCard data={{ adCreativeSide: [] }} />);
    expect(container.innerHTML).toBe("");
  });
  it("filters out entries with all null/empty values", () => {
    const { container } = render(
      <UserAdCreativeDataCard
        data={{ adCreativeSide: [{ brandDescription: null, brandName: null, cta: "", platform: "", timestamp: "" }] }}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
  it("renders all fields with values when present", () => {
    const data = {
      adCreativeSide: [{
        brandDescription: "Cool jeans",
        brandName: "Levis",
        cta: "Shop",
        platform: "Instagram",
        timestamp: "2025-02-02",
      }],
    };
    const { getByText } = render(<UserAdCreativeDataCard data={data} />);
    expect(getByText("AdCreative Data")).toBeInTheDocument();
    expect(getByText("Cool jeans")).toBeInTheDocument();
    expect(getByText("Levis")).toBeInTheDocument();
    expect(getByText("Shop")).toBeInTheDocument();
    expect(getByText("Instagram")).toBeInTheDocument();
    expect(getByText("2025-02-02")).toBeInTheDocument();
  });
  it("renders N/A for missing fields when at least one value present", () => {
    const { getAllByText } = render(
      <UserAdCreativeDataCard data={{ adCreativeSide: [{ brandDescription: "x" }] }} />,
    );
    expect(getAllByText("N/A").length).toBeGreaterThan(2);
  });
  it("brandName falsy → renders N/A even when other fields present", () => {
    const { getAllByText } = render(
      <UserAdCreativeDataCard data={{ adCreativeSide: [{ brandDescription: "x", brandName: null }] }} />,
    );
    expect(getAllByText("N/A").length).toBeGreaterThan(0);
  });
  it("renders multiple entries", () => {
    const { getByText } = render(
      <UserAdCreativeDataCard data={{ adCreativeSide: [{ brandName: "A" }, { brandName: "B" }] }} />,
    );
    expect(getByText("A")).toBeInTheDocument();
    expect(getByText("B")).toBeInTheDocument();
  });
});

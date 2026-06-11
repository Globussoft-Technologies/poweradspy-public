import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import UserAdCopyData from "../../src/components/UserAdCopyData.jsx";

describe("UserAdCopyData", () => {
  it("returns null when no data prop", () => {
    const { container } = render(<UserAdCopyData />);
    expect(container.innerHTML).toBe("");
  });
  it("returns null when adCopySide is empty", () => {
    const { container } = render(<UserAdCopyData data={{ adCopySide: [] }} />);
    expect(container.innerHTML).toBe("");
  });
  it("filters out entries with all null/empty values", () => {
    const data = {
      adCopySide: [
        { brandDescription: null, brandName: null, cta: "", platform: "", timestamp: "" },
      ],
    };
    const { container } = render(<UserAdCopyData data={data} />);
    expect(container.innerHTML).toBe("");
  });
  it("renders entries that have at least one non-empty value", () => {
    const data = {
      adCopySide: [{ brandName: "Nike", brandDescription: "", cta: "", platform: "", timestamp: "" }],
    };
    const { getByText, getAllByText } = render(<UserAdCopyData data={data} />);
    expect(getByText("AdCopy Data")).toBeInTheDocument();
    expect(getByText("Nike")).toBeInTheDocument();
    // N/A appears for missing fields (brandDescription, cta, platform, timestamp)
    expect(getAllByText("N/A").length).toBeGreaterThan(0);
  });
  it("displays all five fields with values when present", () => {
    const data = {
      adCopySide: [{
        brandDescription: "Premium shoes",
        brandName: "Nike",
        cta: "Buy now",
        platform: "Facebook",
        timestamp: "2025-01-01",
      }],
    };
    const { getByText } = render(<UserAdCopyData data={data} />);
    expect(getByText("Premium shoes")).toBeInTheDocument();
    expect(getByText("Nike")).toBeInTheDocument();
    expect(getByText("Buy now")).toBeInTheDocument();
    expect(getByText("Facebook")).toBeInTheDocument();
    expect(getByText("2025-01-01")).toBeInTheDocument();
  });
  it("brandName falsy + brandDescription present → renders N/A for brandName", () => {
    const data = {
      adCopySide: [{ brandDescription: "desc", brandName: null }],
    };
    const { getAllByText } = render(<UserAdCopyData data={data} />);
    // Two N/As: brandName, cta, platform, timestamp
    expect(getAllByText("N/A").length).toBeGreaterThan(0);
  });
  it("renders multiple entries", () => {
    const data = {
      adCopySide: [
        { brandName: "Nike" },
        { brandName: "Adidas" },
      ],
    };
    const { getByText } = render(<UserAdCopyData data={data} />);
    expect(getByText("Nike")).toBeInTheDocument();
    expect(getByText("Adidas")).toBeInTheDocument();
  });
});

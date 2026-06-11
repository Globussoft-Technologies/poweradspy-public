import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import UserScrollDataCard from "../../src/components/UserScrollDataCard.jsx";

describe("UserScrollDataCard", () => {
  it("data.scroll undefined → returns null", () => {
    const { container } = render(<UserScrollDataCard data={{}} />);
    expect(container.innerHTML).toBe("");
  });
  it("scroll array empty → returns null", () => {
    const { container } = render(<UserScrollDataCard data={{ scroll: [] }} />);
    expect(container.innerHTML).toBe("");
  });
  it("scroll items with all-falsy fields → filtered out → null", () => {
    const { container } = render(
      <UserScrollDataCard data={{ scroll: [
        { card1: { scrollCount: 0, totalPercentSeen: 0, totalNewDataFetched: 0, adId: [] } },
      ]}} />,
    );
    expect(container.innerHTML).toBe("");
  });
  it("renders heading + key labels", () => {
    const { getByText } = render(
      <UserScrollDataCard data={{ scroll: [
        { "card-a": { scrollCount: 3, totalPercentSeen: 75, totalNewDataFetched: 5, adId: ["a1", "a2"], timestamp: "2025-04-01" } },
      ]}} />,
    );
    expect(getByText("Scroll Data")).toBeInTheDocument();
    expect(getByText("card-a")).toBeInTheDocument();
    expect(getByText("Scroll Count:")).toBeInTheDocument();
    expect(getByText("Ads Seen:")).toBeInTheDocument();
  });
  it("displays scrollCount, totalPercentSeen, totalNewDataFetched values", () => {
    const { getByText } = render(
      <UserScrollDataCard data={{ scroll: [
        { "card-a": { scrollCount: 3, totalPercentSeen: 75, totalNewDataFetched: 5, adId: ["a1"], timestamp: "ts" } },
      ]}} />,
    );
    expect(getByText("3")).toBeInTheDocument();
    expect(getByText("75")).toBeInTheDocument();
    expect(getByText("5")).toBeInTheDocument();
  });
  it("Ads Seen joins adId array with comma", () => {
    const { getByText } = render(
      <UserScrollDataCard data={{ scroll: [
        { "card-a": { scrollCount: 1, adId: ["ad1", "ad2", "ad3"] } },
      ]}} />,
    );
    expect(getByText("ad1, ad2, ad3")).toBeInTheDocument();
  });
  it("adId absent → 'Ads Seen' shows 0", () => {
    const { getAllByText } = render(
      <UserScrollDataCard data={{ scroll: [
        { "card-a": { scrollCount: 1 } },
      ]}} />,
    );
    // 0 appears multiple times (totalPercentSeen=0, totalNewDataFetched=0, Ads Seen=0)
    expect(getAllByText("0").length).toBeGreaterThanOrEqual(2);
  });
  it("timestamp absent → 'N/A'", () => {
    const { getByText } = render(
      <UserScrollDataCard data={{ scroll: [
        { "card-a": { scrollCount: 1 } },
      ]}} />,
    );
    expect(getByText("N/A")).toBeInTheDocument();
  });
  it("falls back to adId.length when totalNewDataFetched missing", () => {
    const { container, getAllByText } = render(
      <UserScrollDataCard data={{ scroll: [
        { "card-a": { scrollCount: 1, adId: ["a", "b", "c"] } },
      ]}} />,
    );
    // totalNewDataFetched defaults to adId.length = 3
    expect(getAllByText("3").length).toBeGreaterThan(0);
  });
  it("renders multiple cards from multiple scroll entries + multiple keys", () => {
    const { getByText } = render(
      <UserScrollDataCard data={{ scroll: [
        { "card-a": { scrollCount: 1 }, "card-b": { scrollCount: 2 } },
        { "card-c": { totalPercentSeen: 50 } },
      ]}} />,
    );
    expect(getByText("card-a")).toBeInTheDocument();
    expect(getByText("card-b")).toBeInTheDocument();
    expect(getByText("card-c")).toBeInTheDocument();
  });
  it("entry kept when only adId has entries (no other counts)", () => {
    const { getByText } = render(
      <UserScrollDataCard data={{ scroll: [
        { "card-a": { adId: ["only-ad"] } },
      ]}} />,
    );
    expect(getByText("only-ad")).toBeInTheDocument();
  });
  it("entry kept when only totalPercentSeen is set", () => {
    const { getByText } = render(
      <UserScrollDataCard data={{ scroll: [
        { "card-a": { totalPercentSeen: 25 } },
      ]}} />,
    );
    expect(getByText("25")).toBeInTheDocument();
  });
  it("entry kept when only totalNewDataFetched is set", () => {
    const { getByText } = render(
      <UserScrollDataCard data={{ scroll: [
        { "card-a": { totalNewDataFetched: 7 } },
      ]}} />,
    );
    expect(getByText("7")).toBeInTheDocument();
  });
});

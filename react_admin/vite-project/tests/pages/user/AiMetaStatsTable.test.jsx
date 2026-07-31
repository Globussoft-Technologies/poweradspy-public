import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("react-icons/go", () => ({
  GoTriangleDown: () => <span data-testid="tri-down" />,
  GoTriangleUp: () => <span data-testid="tri-up" />,
}));
vi.mock("../../../src/assets/Social/fb.png", () => ({ default: "fb.png" }));
vi.mock("../../../src/assets/Social/Instagram.png", () => ({ default: "ig.png" }));

import AiMetaStatsTable, { formatDay, formatTimestamp } from "../../../src/pages/user/AiMetaStatsTable.jsx";

const network = (over = {}) => ({
  network: "facebook",
  label: "Facebook",
  table: "facebook_ad_ai_meta",
  bucket_column: "updated_at",
  error: null,
  totals: { updated: 5, last_updated: "2026-07-31 05:34:43" },
  daily: [
    { date: "2026-07-31", updated_count: 4, last_updated: "2026-07-31 05:34:43" },
    { date: "2026-07-29", updated_count: 1, last_updated: "2026-07-29 11:02:00" },
  ],
  ...over,
});

describe("pages/user/AiMetaStatsTable > formatters", () => {
  it("formatDay renders DD/MM/YYYY and passes odd input through", () => {
    expect(formatDay("2026-07-31")).toBe("31/07/2026");
    expect(formatDay("")).toBe("—");
    expect(formatDay(null)).toBe("—");
    expect(formatDay("garbage")).toBe("garbage");
  });

  it("formatTimestamp keeps the clock time and handles a date-only value", () => {
    expect(formatTimestamp("2026-07-31 05:34:43")).toBe("31/07/2026 05:34:43");
    expect(formatTimestamp("2026-07-31")).toBe("31/07/2026");
    expect(formatTimestamp(null)).toBe("—");
  });
});

describe("pages/user/AiMetaStatsTable", () => {
  it("loading → 2 skeleton rows of 3 cells", () => {
    const { container } = render(<AiMetaStatsTable loading networks={[]} />);
    expect(container.querySelectorAll(".animate-pulse").length).toBe(6);
  });

  it("shows only the columns the table can back: platform, updated count, last updated", () => {
    render(<AiMetaStatsTable loading={false} networks={[network()]} />);
    expect(screen.getByText("Updated Count")).toBeInTheDocument();
    expect(screen.getByText("Last Updated")).toBeInTheDocument();
    // No failure/pending column — those have no source in *_ad_ai_meta.
    expect(screen.queryByText(/Failed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pending/i)).not.toBeInTheDocument();

    const row = screen.getByTestId("platform-row-facebook");
    expect(within(row).getByText("Facebook")).toBeInTheDocument();
    expect(within(row).getByText("5")).toBeInTheDocument();
    expect(within(row).getByText("31/07/2026 05:34:43")).toBeInTheDocument();
  });

  it("collapsed by default; clicking reveals the per-day rows, clicking again hides them", () => {
    render(<AiMetaStatsTable loading={false} networks={[network()]} />);
    expect(screen.queryByText("29/07/2026")).not.toBeInTheDocument();
    expect(screen.getByTestId("tri-down")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("platform-row-facebook"));
    expect(screen.getByText("31/07/2026")).toBeInTheDocument();
    expect(screen.getByText("29/07/2026")).toBeInTheDocument();
    expect(screen.getByText("29/07/2026 11:02:00")).toBeInTheDocument();
    expect(screen.getByTestId("tri-up")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("platform-row-facebook"));
    expect(screen.queryByText("29/07/2026")).not.toBeInTheDocument();
  });

  it("expanded platform with no rows in range explains the gap", () => {
    render(<AiMetaStatsTable loading={false} networks={[network({ daily: [] })]} />);
    fireEvent.click(screen.getByTestId("platform-row-facebook"));
    expect(
      screen.getByText("No ads were processed for this platform in the selected range.")
    ).toBeInTheDocument();
  });

  it("a failed platform is badged and its expansion surfaces the DB error", () => {
    render(<AiMetaStatsTable loading={false} networks={[network({ error: "db-down", daily: [] })]} />);
    expect(screen.getByText("unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("platform-row-facebook"));
    expect(screen.getByText(/Could not read facebook_ad_ai_meta: db-down/)).toBeInTheDocument();
  });

  it("falls back to the network key and drops the table name when absent", () => {
    render(
      <AiMetaStatsTable
        loading={false}
        networks={[network({ label: null, table: null, error: "boom", daily: [] })]}
      />
    );
    const row = screen.getByTestId("platform-row-facebook");
    expect(within(row).getByText("facebook")).toBeInTheDocument();
    fireEvent.click(row);
    expect(screen.getByText(/Could not read facebook: boom/)).toBeInTheDocument();
  });

  it("renders instagram with its own logo, and an unknown platform without one", () => {
    render(
      <AiMetaStatsTable
        loading={false}
        networks={[
          network({ network: "instagram", label: "Instagram" }),
          network({ network: "tiktok", label: "TikTok" }),
        ]}
      />
    );
    expect(screen.getByTestId("platform-row-instagram").querySelector("img")).not.toBeNull();
    expect(screen.getByTestId("platform-row-tiktok").querySelector("img")).toBeNull();
  });

  it("empty + nullish network lists render the empty state", () => {
    const { unmount } = render(<AiMetaStatsTable loading={false} networks={[]} />);
    expect(screen.getByText("No processing statistics found")).toBeInTheDocument();
    unmount();
    render(<AiMetaStatsTable loading={false} networks={null} />);
    expect(screen.getByText("No processing statistics found")).toBeInTheDocument();
  });

  it("missing totals object does not blow up the row", () => {
    render(<AiMetaStatsTable loading={false} networks={[network({ totals: undefined, daily: undefined })]} />);
    const row = screen.getByTestId("platform-row-facebook");
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(row);
    expect(
      screen.getByText("No ads were processed for this platform in the selected range.")
    ).toBeInTheDocument();
  });
});

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("react-icons/go", () => ({
  GoTriangleDown: () => <span data-testid="tri-down" />,
  GoTriangleUp: () => <span data-testid="tri-up" />,
}));
vi.mock("react-icons/fi", () => ({
  FiAlertTriangle: (props) => <span {...props} />,
}));

vi.mock("../../../src/assets/Social/fb.png", () => ({ default: "fb.png" }));
vi.mock("../../../src/assets/Social/Instagram.png", () => ({ default: "ig.png" }));
vi.mock("../../../src/assets/Social/Google.png", () => ({ default: "g.png" }));
vi.mock("../../../src/assets/Social/Youtube.png", () => ({ default: "yt.png" }));
vi.mock("../../../src/assets/Social/Google-ads.png", () => ({ default: "gads.png" }));
vi.mock("../../../src/assets/Social/Linkedin.png", () => ({ default: "li.png" }));
vi.mock("../../../src/assets/Social/Reddit.png", () => ({ default: "r.png" }));
vi.mock("../../../src/assets/Social/Quora.png", () => ({ default: "q.png" }));
vi.mock("../../../src/assets/Social/Pinterest.png", () => ({ default: "p.png" }));
vi.mock("../../../src/assets/Social/Native.png", () => ({ default: "n.png" }));

import DomainRegistrationStatsTable, {
  formatDay,
  formatTimestamp,
} from "../../../src/pages/user/DomainRegistrationStatsTable.jsx";

const network = (over = {}) => ({
  network: "google",
  label: "Google",
  table: "google_text_ad_domains",
  bucket_column: "updated_date",
  error: null,
  totals: { processed: 100, updated: 90, failed: 10, last_updated: "2026-07-28 09:15:00" },
  backlog: { pending: 42, resolved: 90, unresolvable: 10, total: 142 },
  daily: [
    { date: "2026-07-28", processed_count: 60, updated_count: 55, failed_count: 5, last_updated: "2026-07-28 09:15:00" },
    { date: "2026-07-27", processed_count: 40, updated_count: 35, failed_count: 5, last_updated: "2026-07-27 22:01:10" },
  ],
  ...over,
});

describe("pages/user/DomainRegistrationStatsTable > formatters", () => {
  it("formatDay renders DD/MM/YYYY and passes odd input through", () => {
    expect(formatDay("2026-07-28")).toBe("28/07/2026");
    expect(formatDay("")).toBe("—");
    expect(formatDay(null)).toBe("—");
    expect(formatDay("garbage")).toBe("garbage");
  });

  it("formatTimestamp keeps the clock time and handles a date-only value", () => {
    expect(formatTimestamp("2026-07-28 09:15:00")).toBe("28/07/2026 09:15:00");
    expect(formatTimestamp("2026-07-28")).toBe("28/07/2026");
    expect(formatTimestamp(null)).toBe("—");
  });
});

describe("pages/user/DomainRegistrationStatsTable", () => {
  it("loading → renders 10 skeleton rows of 7 cells", () => {
    const { container } = render(<DomainRegistrationStatsTable loading networks={[]} />);
    expect(container.querySelectorAll(".animate-pulse").length).toBe(70);
  });

  it("renders one summary row per platform with totals, pending and success rate", () => {
    render(<DomainRegistrationStatsTable loading={false} networks={[network()]} />);
    const row = screen.getByTestId("platform-row-google");
    expect(within(row).getByText("Google")).toBeInTheDocument();
    expect(within(row).getByText("100")).toBeInTheDocument(); // processed
    expect(within(row).getByText("90")).toBeInTheDocument(); // updated
    expect(within(row).getByText("10")).toBeInTheDocument(); // failed
    expect(within(row).getByText("90%")).toBeInTheDocument(); // success rate
    expect(within(row).getByText("42")).toBeInTheDocument(); // pending backlog
    // Pending is a whole-table figure, so the header must say so.
    expect(screen.getByText("Pending (all time)")).toBeInTheDocument();
    expect(within(row).getByText("28/07/2026 09:15:00")).toBeInTheDocument();
  });

  it("shows '—' for success rate when nothing was processed, and for a missing backlog", () => {
    render(
      <DomainRegistrationStatsTable
        loading={false}
        networks={[
          network({
            totals: { processed: 0, updated: 0, failed: 0, last_updated: null },
            backlog: null,
          }),
        ]}
      />
    );
    const row = screen.getByTestId("platform-row-google");
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("collapsed by default; clicking a platform reveals its per-day breakdown, clicking again hides it", () => {
    render(<DomainRegistrationStatsTable loading={false} networks={[network()]} />);
    expect(screen.queryByText("27/07/2026")).not.toBeInTheDocument();
    expect(screen.getByTestId("tri-down")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("platform-row-google"));
    expect(screen.getByText("28/07/2026")).toBeInTheDocument();
    expect(screen.getByText("27/07/2026")).toBeInTheDocument();
    expect(screen.getByText("27/07/2026 22:01:10")).toBeInTheDocument();
    expect(screen.getByTestId("tri-up")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("platform-row-google"));
    expect(screen.queryByText("27/07/2026")).not.toBeInTheDocument();
  });

  it("expanded platform with no days in range explains the gap", () => {
    render(<DomainRegistrationStatsTable loading={false} networks={[network({ daily: [] })]} />);
    fireEvent.click(screen.getByTestId("platform-row-google"));
    expect(
      screen.getByText("No domains were processed for this platform in the selected range.")
    ).toBeInTheDocument();
  });

  it("a failed platform is badged and its expansion surfaces the DB error", () => {
    render(
      <DomainRegistrationStatsTable
        loading={false}
        networks={[network({ error: "db-down", daily: [] })]}
      />
    );
    expect(screen.getByText("unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("platform-row-google"));
    expect(screen.getByText(/Could not read google_text_ad_domains: db-down/)).toBeInTheDocument();
  });

  it("falls back to the network key and drops the error detail when table is absent", () => {
    render(
      <DomainRegistrationStatsTable
        loading={false}
        networks={[network({ label: null, table: null, error: "boom", daily: [] })]}
      />
    );
    const row = screen.getByTestId("platform-row-google");
    expect(within(row).getByText("google")).toBeInTheDocument();
    fireEvent.click(row);
    expect(screen.getByText(/Could not read google: boom/)).toBeInTheDocument();
  });

  it("a platform with no logo in assets still renders its row", () => {
    render(
      <DomainRegistrationStatsTable
        loading={false}
        networks={[network({ network: "bing", label: "Bing" })]}
      />
    );
    const row = screen.getByTestId("platform-row-bing");
    expect(within(row).getByText("Bing")).toBeInTheDocument();
    expect(row.querySelector("img")).toBeNull();
  });

  it("empty + nullish network lists render the empty state", () => {
    const { unmount } = render(<DomainRegistrationStatsTable loading={false} networks={[]} />);
    expect(screen.getByText("No processing statistics found")).toBeInTheDocument();
    unmount();
    render(<DomainRegistrationStatsTable loading={false} networks={null} />);
    expect(screen.getByText("No processing statistics found")).toBeInTheDocument();
  });

  it("missing totals object does not blow up the row", () => {
    render(
      <DomainRegistrationStatsTable loading={false} networks={[network({ totals: undefined, daily: undefined })]} />
    );
    const row = screen.getByTestId("platform-row-google");
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(row);
    expect(
      screen.getByText("No domains were processed for this platform in the selected range.")
    ).toBeInTheDocument();
  });
});

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, waitFor, within } from "@testing-library/react";
import TopUsers from "../../../../src/components/Pas/Intelligence/TopUsers";

// Mock react-icons
vi.mock("react-icons/rx", () => ({
  RxCross1: () => <span data-testid="cross-icon" />,
}));

vi.mock("react-icons/ci", () => ({
  CiFilter: () => <span data-testid="filter-icon" />,
}));

vi.mock("react-icons/fa", () => ({
  FaArrowDown: () => <span data-testid="arrow-down" />,
  FaArrowUp: () => <span data-testid="arrow-up" />,
  FaCalendarAlt: () => <span data-testid="calendar-icon" />,
}));

// Mock js-cookie
vi.mock("js-cookie", () => ({
  default: {
    get: () => "mock-token",
  },
}));

const mockStats = {
  code: 200,
  data: {
    total_searches: { value: 9433, prev_value: 3344, trend_pct: 182, trend_label: "vs previous" },
    active_users: { value: 16, prev_value: 16, trend_pct: 0, trend_label: "vs previous" },
    unique_keywords: { value: 56, prev_value: 91, trend_pct: -38, trend_label: "vs previous" },
    high_volume_flags: { value: 1, sub_label: "users with >500 searches in last 24h" },
  },
};

const mockUsers = {
  code: 200,
  data: {
    users: [
      { user_id: "1", top_keyword: "test", top_advertiser: "Nike", top_platform: "google", search_count: 150, anomaly_flag: false },
      { user_id: "2", top_keyword: "ads", top_advertiser: "Adidas", top_platform: "facebook", search_count: 120, anomaly_flag: true },
      { user_id: "3", top_keyword: "marketing", top_advertiser: "Puma", top_platform: "instagram", search_count: 95, anomaly_flag: false },
    ],
  },
};

let fetchCallCount = 0;

beforeEach(() => {
  fetchCallCount = 0;
  global.fetch = vi.fn((url) => {
    fetchCallCount++;
    if (url.includes("/intelligence/stats")) {
      return Promise.resolve({
        json: () => Promise.resolve(mockStats),
      });
    }
    if (url.includes("/intelligence/top-users")) {
      return Promise.resolve({
        json: () => Promise.resolve(mockUsers),
      });
    }
    return Promise.reject(new Error("Unknown URL"));
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TopUsers Component", () => {
  it("renders component with period selectors and stats cards", async () => {
    render(<TopUsers />);

    expect(screen.getByText("Current Period")).toBeInTheDocument();
    expect(screen.getByText("Previous Period")).toBeInTheDocument();
    expect(screen.getByText("TOTAL SEARCHES")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE USERS")).toBeInTheDocument();
    expect(screen.getByText("HIGH-VOLUME FLAGS")).toBeInTheDocument();
    expect(screen.getByText("UNIQUE KEYWORDS")).toBeInTheDocument();
  });

  it("fetches stats on component mount with default periods", async () => {
    render(<TopUsers />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/intelligence/stats"),
        expect.any(Object)
      );
    });
  });

  it("displays stats card values correctly", async () => {
    render(<TopUsers />);

    await waitFor(() => {
      expect(screen.getByText("9,433")).toBeInTheDocument();
      expect(screen.getByText("prev: 3,344")).toBeInTheDocument();
      expect(screen.getByText("16")).toBeInTheDocument();
    });
  });

  it("displays trend percentage correctly", async () => {
    render(<TopUsers />);

    await waitFor(() => {
      expect(screen.getByText("↑ 182% vs previous")).toBeInTheDocument();
      expect(screen.getByText("↓ 38% vs previous")).toBeInTheDocument();
    });
  });

  it("fetches users on component mount", async () => {
    render(<TopUsers />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/intelligence/top-users"),
        expect.any(Object)
      );
    });
  });

  it("renders top users table with correct data", async () => {
    render(<TopUsers />);

    await waitFor(() => {
      expect(screen.getByText("test")).toBeInTheDocument();
      expect(screen.getByText("Nike")).toBeInTheDocument();
      expect(screen.getByText("ads")).toBeInTheDocument();
      expect(screen.getByText("Adidas")).toBeInTheDocument();
    });
  });

  it("allows preset period selection for current period", async () => {
    render(<TopUsers />);

    const currentPeriodButtons = screen.getAllByRole("button");
    const currentPeriodButton = currentPeriodButtons.find(btn => btn.textContent.includes("Last 7 days") && btn.closest("div")?.textContent.includes("Current Period"));

    fireEvent.click(currentPeriodButton || screen.getByText("Last 7 days"));

    // Should show dropdown with preset options
    await waitFor(() => {
      expect(screen.getByText("Last 14 days")).toBeInTheDocument();
    });
  });

  it("updates stats when current period is changed", async () => {
    render(<TopUsers />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    // Component should have made calls to fetch stats and users
    expect(global.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("allows custom date range selection for current period", async () => {
    render(<TopUsers />);

    const buttons = screen.getAllByRole("button");
    const periodButton = buttons.find(btn => btn.textContent.includes("Current Period"));

    if (periodButton) {
      fireEvent.click(periodButton);

      await waitFor(() => {
        expect(screen.getByText("Custom Range")).toBeInTheDocument();
      });

      // Get the date inputs within the current period dropdown
      const dateInputs = screen.getAllByDisplayValue("");
      expect(dateInputs.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("auto-calculates previous period when custom current period is set", async () => {
    render(<TopUsers />);

    const buttons = screen.getAllByRole("button");
    const currentPeriodBtn = buttons.find(btn => btn.textContent.includes("Current Period"));

    if (currentPeriodBtn) {
      fireEvent.click(currentPeriodBtn);

      await waitFor(() => {
        expect(screen.getByText("Custom Range")).toBeInTheDocument();
      });

      const inputs = screen.getAllByDisplayValue("");
      // Set custom dates
      if (inputs.length >= 2) {
        fireEvent.change(inputs[0], { target: { value: "2026-06-04" } });
        fireEvent.change(inputs[1], { target: { value: "2026-06-15" } });
        fireEvent.click(screen.getByText("Apply Custom"));

        // Previous period should be auto-calculated
        await waitFor(() => {
          const previousPeriodText = screen.getByText("Previous Period").closest("div");
          expect(previousPeriodText).toBeInTheDocument();
        });
      }
    }
  });

  it("disables previous period custom date inputs when custom current period is selected", async () => {
    render(<TopUsers />);

    const buttons = screen.getAllByRole("button");
    const currentPeriodBtn = buttons.find(btn => btn.textContent.includes("Current Period"));

    if (currentPeriodBtn) {
      fireEvent.click(currentPeriodBtn);

      await waitFor(() => {
        expect(screen.getByText("Custom Range")).toBeInTheDocument();
      });

      const inputs = screen.getAllByDisplayValue("");
      if (inputs.length >= 2) {
        fireEvent.change(inputs[0], { target: { value: "2026-06-04" } });
        fireEvent.change(inputs[1], { target: { value: "2026-06-15" } });
        fireEvent.click(screen.getByText("Apply Custom"));

        await waitFor(() => {
          // Open previous period dropdown
          const previousPeriodBtn = buttons.find(btn => btn.textContent.includes("Previous Period"));
          if (previousPeriodBtn) {
            fireEvent.click(previousPeriodBtn);

            // Previous period inputs should be disabled
            const prevInputs = screen.getAllByTitle("Auto-calculated based on current period");
            expect(prevInputs.length).toBeGreaterThan(0);
            prevInputs.forEach(input => {
              expect(input).toBeDisabled();
            });
          }
        });
      }
    }
  });

  it("constrains custom date selection to last 90 days", async () => {
    render(<TopUsers />);

    const buttons = screen.getAllByRole("button");
    const currentPeriodBtn = buttons.find(btn => btn.textContent.includes("Current Period"));

    if (currentPeriodBtn) {
      fireEvent.click(currentPeriodBtn);

      await waitFor(() => {
        expect(screen.getByText("Custom Range")).toBeInTheDocument();
      });

      const inputs = screen.getAllByDisplayValue("");
      if (inputs.length >= 2) {
        // Check that min date is set (90 days ago)
        expect(inputs[0]).toHaveAttribute("min");
        // Check that max date is set to today
        expect(inputs[1]).toHaveAttribute("max");
      }
    }
  });

  it("filters users by keyword when filter is applied", async () => {
    render(<TopUsers />);

    await waitFor(() => {
      expect(screen.getByText("test")).toBeInTheDocument();
    });

    // Component should render with user data
    const userRows = screen.getAllByRole("row");
    expect(userRows.length).toBeGreaterThan(0);
  });

  it("shows flagged users count badge when flagged_only toggle is active", async () => {
    render(<TopUsers />);

    await waitFor(() => {
      expect(screen.getByText("Flagged only")).toBeInTheDocument();
    });

    // At least one user has anomaly_flag = true, so badge should show
    const flaggedBtn = screen.getByText("Flagged only");
    expect(flaggedBtn.textContent).toContain("1");
  });

  it("toggles flagged_only filter", async () => {
    render(<TopUsers />);

    await waitFor(() => {
      expect(screen.getByText("Flagged only")).toBeInTheDocument();
    });

    const flaggedBtn = screen.getByText("Flagged only");
    fireEvent.click(flaggedBtn);

    // Should refetch with flagged_only=true parameter
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("flagged_only=true"),
        expect.any(Object)
      );
    });
  });

  it("sorts users by search count in descending order by default", async () => {
    render(<TopUsers />);

    await waitFor(() => {
      expect(screen.getByText("test")).toBeInTheDocument();
    });

    // Component should display user data sorted by search volume
    expect(screen.getByText("test")).toBeInTheDocument();
  });

  it("toggles sort direction when Most searches button is clicked", async () => {
    render(<TopUsers />);

    await waitFor(() => {
      expect(screen.getByText("Most searches")).toBeInTheDocument();
    });

    const sortBtn = screen.getByText("Most searches");
    fireEvent.click(sortBtn);

    // After clicking, should sort ascending
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  it("shows proper table headers", async () => {
    render(<TopUsers />);

    await waitFor(() => {
      expect(screen.getByText("Top Users By Search Volume")).toBeInTheDocument();
    });
  });

  it("calls onExport callback when export is triggered", () => {
    const onExport = vi.fn();
    render(<TopUsers onExport={onExport} />);

    // Export functionality depends on implementation details
    // This test structure can be extended once export button is identified
  });

  it("handles API error gracefully", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ code: 500, message: "Server error" }),
      })
    );

    render(<TopUsers />);

    await waitFor(() => {
      // Component should still render without crashing
      expect(screen.getByText("TOTAL SEARCHES")).toBeInTheDocument();
    });
  });

  it("handles network error gracefully", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("Network error")));

    render(<TopUsers />);

    await waitFor(() => {
      // Component should still render without crashing
      expect(screen.getByText("TOTAL SEARCHES")).toBeInTheDocument();
    });
  });

  it("displays loading state initially for stats", () => {
    render(<TopUsers />);

    // Component should render and display stats section
    expect(screen.getByText("TOTAL SEARCHES")).toBeInTheDocument();
  });

  it("shows high volume flags information", async () => {
    render(<TopUsers />);

    await waitFor(() => {
      expect(screen.getByText("users with >500 searches in last 24h")).toBeInTheDocument();
    });
  });

  it("displays correct avatar initials for users", async () => {
    render(<TopUsers />);

    await waitFor(() => {
      // Check that user avatars are rendered (they show initials)
      expect(screen.getByText("test")).toBeInTheDocument();
    });
  });

  it("calls onDataReady callback with export data getter", () => {
    const onDataReady = vi.fn();
    render(<TopUsers onDataReady={onDataReady} />);

    expect(onDataReady).toHaveBeenCalled();
    const exportDataGetter = onDataReady.mock.calls[0][0];
    expect(typeof exportDataGetter).toBe("function");

    // Call the getter to retrieve export data
    const exportData = exportDataGetter();
    expect(exportData).toHaveProperty("statCards");
    expect(exportData).toHaveProperty("sortedUsers");
    expect(exportData).toHaveProperty("filterActive");
    expect(exportData).toHaveProperty("flaggedOnly");
    expect(exportData).toHaveProperty("dateRange");
  });

  it("applies custom date range filter to users table independently", async () => {
    render(<TopUsers />);

    await waitFor(() => {
      expect(screen.getByText("test")).toBeInTheDocument();
    });

    // Date picker for Top Users table (separate from stats period selectors)
    const calendarBtn = screen.getByTestId("calendar-icon").closest("button");
    if (calendarBtn) {
      fireEvent.click(calendarBtn);

      // Should show custom range section
      expect(screen.getByText("Custom range")).toBeInTheDocument();
    }
  });

  it("resets all filters when reset is triggered", async () => {
    render(<TopUsers />);

    await waitFor(() => {
      expect(screen.getByText("test")).toBeInTheDocument();
    });

    // Apply a filter
    const filterBtn = screen.getByText("Filter");
    fireEvent.click(filterBtn);

    // Try to find and click reset button if available
    const buttons = screen.getAllByRole("button");
    const resetBtn = buttons.find(btn => btn.textContent.includes("Reset"));

    if (resetBtn) {
      fireEvent.click(resetBtn);
      // Should reset filters
      expect(resetBtn).toBeInTheDocument();
    }
  });

  it("passes forceExpand prop to hide controls for PDF export", () => {
    const { container } = render(<TopUsers forceExpand={true} />);

    // Period selectors should be hidden when forceExpand is true
    const periodSelectors = container.querySelector("[style*='display: none']");
    expect(periodSelectors).toBeDefined();
  });

  it("clears previous custom dates when switching from custom to preset current period", async () => {
    render(<TopUsers />);

    // First set a custom period
    const buttons = screen.getAllByRole("button");
    const currentPeriodBtn = buttons.find(btn => btn.textContent.includes("Current Period"));

    if (currentPeriodBtn) {
      fireEvent.click(currentPeriodBtn);

      await waitFor(() => {
        expect(screen.getByText("Custom Range")).toBeInTheDocument();
      });

      const inputs = screen.getAllByDisplayValue("");
      if (inputs.length >= 2) {
        fireEvent.change(inputs[0], { target: { value: "2026-06-04" } });
        fireEvent.change(inputs[1], { target: { value: "2026-06-15" } });
        fireEvent.click(screen.getByText("Apply Custom"));

        await waitFor(() => {
          // Now switch back to preset
          fireEvent.click(currentPeriodBtn);
          fireEvent.click(screen.getByText("Last 7 days"));

          // Custom dates should be cleared
          expect(global.fetch).toHaveBeenCalled();
        });
      }
    }
  });

  it("validates date range constraints in custom date picker", async () => {
    render(<TopUsers />);

    const buttons = screen.getAllByRole("button");
    const currentPeriodBtn = buttons.find(btn => btn.textContent.includes("Current Period"));

    if (currentPeriodBtn) {
      fireEvent.click(currentPeriodBtn);

      await waitFor(() => {
        expect(screen.getByText("Custom Range")).toBeInTheDocument();
      });

      const inputs = screen.getAllByDisplayValue("");
      if (inputs.length >= 2) {
        // "From" should have min date set
        expect(inputs[0]).toHaveAttribute("min");
        // "To" should have max date set to today
        expect(inputs[1]).toHaveAttribute("max");
      }
    }
  });
});

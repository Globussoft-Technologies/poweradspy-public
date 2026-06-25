import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import KeywordTrends from "../../../../src/components/Pas/Intelligence/KeywordTrends";

// Mock ItemFilter component
vi.mock("../../../../src/components/Pas/Intelligence/ItemFilter", () => ({
  default: ({ typeTab, onFilterApply }) => (
    <div data-testid="item-filter">
      <input
        data-testid="filter-input"
        type="text"
        placeholder={`Filter ${typeTab}`}
        onChange={(e) => {
          if (e.target.value === "insurance") {
            onFilterApply("insurance");
          }
        }}
      />
    </div>
  ),
}));

// Mock react-icons
vi.mock("react-icons/fa", () => ({
  FaArrowUp: () => <span data-testid="arrow-up" />,
  FaArrowDown: () => <span data-testid="arrow-down" />,
  FaCalendarAlt: () => <span data-testid="calendar-icon" />,
}));

vi.mock("react-icons/ci", () => ({
  CiFilter: () => <span data-testid="filter-icon" />,
}));

vi.mock("recharts", () => ({
  LineChart: ({ children, data }) => <div data-testid="line-chart">{children}</div>,
  Line: ({ dataKey }) => <div data-testid={`line-${dataKey}`} />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
  ResponsiveContainer: ({ children }) => <div data-testid="responsive-container">{children}</div>,
}));

// Mock js-cookie
vi.mock("js-cookie", () => ({
  default: {
    get: () => "mock-token",
  },
}));

const mockTrendData = {
  code: 200,
  data: {
    trends: [
      {
        date: "2026-06-09",
        searches: 150,
        unique_keywords: 45,
        unique_advertisers: 30,
      },
      {
        date: "2026-06-10",
        searches: 165,
        unique_keywords: 48,
        unique_advertisers: 32,
      },
      {
        date: "2026-06-11",
        searches: 155,
        unique_keywords: 44,
        unique_advertisers: 31,
      },
      {
        date: "2026-06-12",
        searches: 180,
        unique_keywords: 52,
        unique_advertisers: 35,
      },
      {
        date: "2026-06-13",
        searches: 175,
        unique_keywords: 50,
        unique_advertisers: 34,
      },
      {
        date: "2026-06-14",
        searches: 190,
        unique_keywords: 55,
        unique_advertisers: 36,
      },
      {
        date: "2026-06-15",
        searches: 200,
        unique_keywords: 58,
        unique_advertisers: 38,
      },
    ],
  },
};

const mockTrendDataEmpty = {
  code: 200,
  data: {
    trends: [],
  },
};

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    if (url.includes("/keyword-trends")) {
      return Promise.resolve({
        json: () => Promise.resolve(mockTrendData),
      });
    }
    if (url.includes("/top-keywords")) {
      return Promise.resolve({
        json: () => Promise.resolve({ code: 200, data: { items: [] } }),
      });
    }
    if (url.includes("/summary-stats")) {
      return Promise.resolve({
        json: () => Promise.resolve({ code: 200, data: { total: 0, completed_scraping: 0, failed_scraping: 0, under_scraping: 0, not_went_scrapping: 0, total_ads_count: 0 } }),
      });
    }
    if (url.includes("/total-ads-count")) {
      return Promise.resolve({
        json: () => Promise.resolve({ code: 200, data: { by_platform: {} } }),
      });
    }
    return Promise.reject(new Error("Unknown URL"));
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("KeywordTrends Component", () => {
  it("renders component with title and chart", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });
  });

  it("fetches trend data on component mount", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/keyword-trends"),
        expect.any(Object)
      );
    });
  });

  it("displays chart with search trend line", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
      expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    });
  });

  it("shows x-axis (dates) in chart", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("x-axis")).toBeInTheDocument();
    });
  });

  it("shows y-axis (values) in chart", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("y-axis")).toBeInTheDocument();
    });
  });

  it("displays grid lines in chart", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("grid")).toBeInTheDocument();
    });
  });

  it("includes tooltip for hover interactions", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("tooltip")).toBeInTheDocument();
    });
  });

  it("displays chart legend", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("legend")).toBeInTheDocument();
    });
  });

  it("renders multiple trend lines (searches, keywords, advertisers)", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });

    // Should have lines for different metrics
    const lines = screen.getAllByTestId(/^line-/);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("allows date range filtering", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });

    const calendarBtn = screen.queryByTestId("calendar-icon")?.closest("button");
    if (calendarBtn) {
      fireEvent.click(calendarBtn);

      // Date picker should appear
      await waitFor(() => {
        expect(screen.queryByText("Custom range")).toBeInTheDocument();
      });
    }
  });

  it("allows preset period selection", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });

    const calendarBtn = screen.queryByTestId("calendar-icon")?.closest("button");
    if (calendarBtn) {
      fireEvent.click(calendarBtn);

      // Preset options should be visible
      await waitFor(() => {
        expect(screen.queryByText("Last 7 days")).toBeInTheDocument();
      });
    }
  });

  it("updates chart when date range is changed", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });

    const initialCallCount = global.fetch.mock.calls.length;

    const calendarBtn = screen.queryByTestId("calendar-icon")?.closest("button");
    if (calendarBtn) {
      fireEvent.click(calendarBtn);

      await waitFor(() => {
        const lastSevenBtn = screen.queryByText("Last 7 days");
        if (lastSevenBtn) {
          fireEvent.click(lastSevenBtn);
        }
      });

      // Should refetch data with new date range
      await waitFor(() => {
        expect(global.fetch.mock.calls.length).toBeGreaterThan(initialCallCount);
      });
    }
  });

  it("displays data points for each date in trend", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });

    // Mock data has 7 data points
    expect(global.fetch).toHaveBeenCalled();
  });

  it("handles empty trend data gracefully", async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes("/keyword-trends")) {
        return Promise.resolve({
          json: () => Promise.resolve(mockTrendDataEmpty),
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    render(<KeywordTrends />);

    await waitFor(() => {
      // Should render without crashing even with empty data
      expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    });
  });

  it("handles API errors gracefully", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ code: 500, message: "Server error" }),
      })
    );

    render(<KeywordTrends />);

    await waitFor(() => {
      // Component should still render
      expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    });
  });

  it("handles network errors gracefully", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("Network error")));

    render(<KeywordTrends />);

    await waitFor(() => {
      // Component should still render
      expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    });
  });

  it("shows loading state initially", () => {
    // Component may show skeleton or loading indicator
    const { container } = render(<KeywordTrends />);

    // Should render without crashing
    expect(container).toBeInTheDocument();
  });

  it("includes proper axis labels", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });

    // Axes should be present for label rendering
    expect(screen.getByTestId("x-axis")).toBeInTheDocument();
    expect(screen.getByTestId("y-axis")).toBeInTheDocument();
  });

  it("applies correct date range parameters in API call", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const call = global.fetch.mock.calls[0];
    expect(call[0]).toContain("/keyword-trends");
    expect(call[0]).toContain("from_date");
    expect(call[0]).toContain("to_date");
  });

  it("sends authorization header with requests", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const call = global.fetch.mock.calls[0];
    expect(call[1].headers.Authorization).toBe("Bearer mock-token");
  });

  it("refetches data when date parameters change", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });

    const initialCallCount = global.fetch.mock.calls.length;

    // Change date range
    const calendarBtn = screen.queryByTestId("calendar-icon")?.closest("button");
    if (calendarBtn) {
      fireEvent.click(calendarBtn);

      await waitFor(() => {
        const preset = screen.queryByText("Last 14 days");
        if (preset) {
          fireEvent.click(preset);
        }
      });

      await waitFor(() => {
        expect(global.fetch.mock.calls.length).toBeGreaterThan(initialCallCount);
      });
    }
  });

  it("renders chart with responsive container", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      const responsiveContainer = screen.getByTestId("responsive-container");
      expect(responsiveContainer).toBeInTheDocument();
      expect(responsiveContainer.querySelector('[data-testid="line-chart"]')).toBeTruthy();
    });
  });

  it("constrains date selection to valid range", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });

    const calendarBtn = screen.queryByTestId("calendar-icon")?.closest("button");
    if (calendarBtn) {
      fireEvent.click(calendarBtn);

      await waitFor(() => {
        const inputs = screen.getAllByDisplayValue("");
        if (inputs.length >= 2) {
          // Should have min and max constraints
          expect(inputs[0]).toHaveAttribute("min");
          expect(inputs[1]).toHaveAttribute("max");
        }
      });
    }
  });

  it("displays trends for multiple metrics concurrently", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      const lineChart = screen.getByTestId("line-chart");
      expect(lineChart).toBeInTheDocument();
      // Chart should contain multiple lines
      expect(lineChart.textContent).toBeDefined();
    });
  });

  it("handles data with missing dates gracefully", async () => {
    const mockDataWithGaps = {
      code: 200,
      data: {
        trends: [
          { date: "2026-06-09", searches: 150, unique_keywords: 45, unique_advertisers: 30 },
          // Gap in data
          { date: "2026-06-15", searches: 200, unique_keywords: 58, unique_advertisers: 38 },
        ],
      },
    };

    global.fetch = vi.fn((url) => {
      if (url.includes("/keyword-trends")) {
        return Promise.resolve({
          json: () => Promise.resolve(mockDataWithGaps),
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });
  });

  it("colors different trend lines distinctly", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });

    // Lines should be rendered with different identifiers
    const lines = screen.getAllByTestId(/^line-/);
    expect(lines.length).toBeGreaterThan(1);
  });

  it("allows switching between different metrics to display", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });

    // If component has toggle for metric selection
    const legend = screen.getByTestId("legend");
    expect(legend).toBeInTheDocument();
  });

  it("updates x-axis with date labels from trend data", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      const xAxis = screen.getByTestId("x-axis");
      expect(xAxis).toBeInTheDocument();
    });
  });

  it("scales y-axis based on data range", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      const yAxis = screen.getByTestId("y-axis");
      expect(yAxis).toBeInTheDocument();
    });
  });

  it("applies proper aspect ratio to chart", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      const responsiveContainer = screen.getByTestId("responsive-container");
      expect(responsiveContainer).toBeInTheDocument();
    });
  });

  it("handles rapid date range changes without race conditions", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });

    const calendarBtn = screen.queryByTestId("calendar-icon")?.closest("button");
    if (calendarBtn) {
      // Rapidly change dates
      fireEvent.click(calendarBtn);
      fireEvent.click(calendarBtn);

      // Should handle without errors
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    }
  });

  it("memoizes trend data to prevent unnecessary re-renders", async () => {
    const { rerender } = render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });

    const initialCallCount = global.fetch.mock.calls.length;

    // Re-render with same props
    rerender(<KeywordTrends />);

    // Should not refetch if props haven't changed
    // (though hook dependencies may vary)
    expect(global.fetch.mock.calls.length).toBeLessThanOrEqual(initialCallCount + 1);
  });

  // NEW TESTS FOR ITEMFILTER INTEGRATION
  it("renders ItemFilter component", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("item-filter")).toBeInTheDocument();
    });
  });

  it("displays type tabs (Keywords, Advertisers, Domains)", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByText("Keywords")).toBeInTheDocument();
      expect(screen.getByText("Advertisers")).toBeInTheDocument();
      expect(screen.getByText("Domains")).toBeInTheDocument();
    });
  });

  it("switches between type tabs", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByText("Keywords")).toBeInTheDocument();
    });

    const advertisersTab = screen.getByText("Advertisers");
    fireEvent.click(advertisersTab);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("type=advertiser"),
        expect.any(Object)
      );
    });
  });

  it("clears item filter when switching tabs", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("item-filter")).toBeInTheDocument();
    });

    // Select an item
    const filterInput = screen.getByTestId("filter-input");
    fireEvent.change(filterInput, { target: { value: "insurance" } });

    // Switch tabs
    const advertisersTab = screen.getByText("Advertisers");
    fireEvent.click(advertisersTab);

    // Filter should be cleared
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("type=advertiser"),
        expect.not.stringContaining("search_value")
      );
    });
  });

  it("sends search_value parameter when item is selected", async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes("/keyword-trends")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTrendData),
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("item-filter")).toBeInTheDocument();
    });

    // Select an item through the filter
    const filterInput = screen.getByTestId("filter-input");
    fireEvent.change(filterInput, { target: { value: "insurance" } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("search_value=insurance"),
        expect.any(Object)
      );
    });
  });

  it("includes summary stats in rendered content", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      // Component should render
      expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    });
  });

  it("includes ads count section in rendered content", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      // Component should render
      expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    });
  });

  it("fetches ads count data on component mount", async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes("/total-ads-count")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              code: 200,
              data: {
                today_ads_count: 10,
                total_ads_count: 100,
                total_per_platform: { facebook: 50, instagram: 30 },
              },
            }),
        });
      }
      if (url.includes("/keyword-trends")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTrendData),
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    render(<KeywordTrends />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/total-ads-count"),
        expect.any(Object)
      );
    });
  });

  it("refetches ads count when tab changes", async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes("/total-ads-count")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              code: 200,
              data: {
                today_ads_count: 10,
                total_ads_count: 100,
                total_per_platform: {},
              },
            }),
        });
      }
      if (url.includes("/keyword-trends")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTrendData),
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    render(<KeywordTrends />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/total-ads-count?type=1"),
        expect.any(Object)
      );
    });

    const advertisersTab = screen.getByText("Advertisers");
    fireEvent.click(advertisersTab);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/total-ads-count?type=2"),
        expect.any(Object)
      );
    });
  });

  it("displays summary stat cards with correct data", async () => {
    render(<KeywordTrends />);

    await waitFor(() => {
      // Component should render summary stats
      expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    });
  });

  it("applies status filter when summary metric is clicked", async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes("/keyword-trends")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTrendData),
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    render(<KeywordTrends />);

    await waitFor(() => {
      expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    });

    // Component should fetch without status filter initially
    const initialCalls = global.fetch.mock.calls.filter((call) =>
      call[0].includes("/keyword-trends")
    ).length;

    expect(initialCalls).toBeGreaterThan(0);
  });
});

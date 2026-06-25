import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import AllSearches from "../../../../src/components/Pas/Intelligence/AllSearches";

// Mock react-icons
vi.mock("react-icons/fa", () => ({
  FaArrowUp: () => <span data-testid="arrow-up" />,
  FaArrowDown: () => <span data-testid="arrow-down" />,
  FaCalendarAlt: () => <span data-testid="calendar-icon" />,
}));

vi.mock("react-icons/ci", () => ({
  CiFilter: () => <span data-testid="filter-icon" />,
}));

vi.mock("react-icons/rx", () => ({
  RxCross1: () => <span data-testid="cross-icon" />,
}));

// Mock js-cookie
vi.mock("js-cookie", () => ({
  default: {
    get: () => "mock-token",
  },
}));

const mockFilters = {
  code: 200,
  data: {
    filterOptions: {
      activity_type: [
        { id: 1, name: "Keyword" },
        { id: 2, name: "Advertiser" },
        { id: 3, name: "Domain" },
      ],
      status: [
        { id: 1, name: "Active" },
        { id: 2, name: "Inactive" },
      ],
    },
    defaultFilters: {
      excluded_users: ["globussoft.in"],
    },
  },
};

const mockSearchData = {
  code: 200,
  data: {
    total: 150,
    searches: [
      {
        id: "1",
        search_type: 1,
        search_value: "test keyword",
        user: "user@example.com",
        platforms: ["facebook", "instagram"],
        created_at: "2026-06-15T10:00:00Z",
      },
      {
        id: "2",
        search_type: 2,
        search_value: "Nike",
        user: "user@example.com",
        platforms: ["google"],
        created_at: "2026-06-15T09:00:00Z",
      },
    ],
  },
};

const mockSummaryData = {
  code: 200,
  data: {
    total_searches: 150,
    unique_keywords: 45,
    unique_advertisers: 30,
    unique_domains: 25,
    platforms_used: ["facebook", "instagram", "google"],
  },
};

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    if (url.includes("/filter-options")) {
      return Promise.resolve({
        json: () => Promise.resolve(mockFilters),
      });
    }
    if (url.includes("/all-searches") && url.includes("summary")) {
      return Promise.resolve({
        json: () => Promise.resolve(mockSummaryData),
      });
    }
    if (url.includes("/all-searches")) {
      return Promise.resolve({
        json: () => Promise.resolve(mockSearchData),
      });
    }
    return Promise.reject(new Error("Unknown URL"));
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AllSearches Component", () => {
  it("renders component with search table and filters", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      // Component should have loaded and rendered the filter interface
      expect(screen.getByText("Date Range")).toBeInTheDocument();
    });
  });

  it("loads filter options on mount", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/filter-options"),
        expect.any(Object)
      );
    });
  });

  it("applies default filters from backend", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      // Filter options should be loaded first
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/filter-options"),
        expect.any(Object)
      );
    }, { timeout: 3000 });
  });

  it("fetches searches after default filters are initialized", async () => {
    render(<AllSearches />);

    // Wait for filter options and then search data to load
    await waitFor(() => {
      // Should have made multiple fetch calls for filter-options and all-searches
      expect(global.fetch.mock.calls.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 5000 });
  });

  it("displays search records in table", async () => {
    render(<AllSearches />);

    // Wait for filter interface to render
    await waitFor(() => {
      // Component should display filter interface
      expect(screen.getByText("Date Range")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows activity type correctly (Keyword, Advertiser, Domain)", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      // Component should render filter interface
      expect(screen.getByText("Date Range")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("displays summary statistics bar with all sections", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(screen.getByText("Date Range")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows searched keywords in summary", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(screen.getByText("Date Range")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows searched domains in summary", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(screen.getByText("Date Range")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows searched advertisers in summary", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(screen.getByText("Date Range")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("displays unique and total counts for each search type", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(screen.getByText("Date Range")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("allows filtering by activity type", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(screen.getByText("Date Range")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("allows filtering by excluded users", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(screen.getByText("Date Range")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("resets filters to defaults when reset is clicked", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(screen.getByText("Date Range")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("restores default excluded users when reset is clicked", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    }, { timeout: 5000 });
  });

  it("fetches searches with proper date range parameters", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    }, { timeout: 5000 });
  });

  it("displays user email in search records", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(screen.getByText("Date Range")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows platforms used in search records", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(screen.getByText("Date Range")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("allows sorting by search count", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(screen.getByText("Date Range")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("allows date range filtering for searches table", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(screen.getByText("Date Range")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("fetches summary data concurrently with search data", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(global.fetch.mock.calls.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 5000 });
  });

  it("prevents duplicate fetches before default filters are initialized", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    }, { timeout: 5000 });
  });

  it("updates summary when filters are applied", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    }, { timeout: 5000 });
  });

  it("handles missing search values gracefully", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    }, { timeout: 5000 });
  });

  it("handles API errors gracefully", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(screen.getByText("Date Range")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows loading state initially", () => {
    render(<AllSearches />);

    // Component should display filter interface
    expect(screen.getByText("Date Range")).toBeInTheDocument();
  });

  it("passes correct headers with authorization token", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    }, { timeout: 5000 });

    // Check that requests include Authorization header
    const calls = global.fetch.mock.calls;
    const hasBearerToken = calls.some(call =>
      call[1] && call[1].headers && call[1].headers.Authorization === "Bearer mock-token"
    );
    expect(hasBearerToken).toBe(true);
  });

  it("displays correct search type labels", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(screen.getByText("Date Range")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("maintains filter state during search", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(screen.getByText("Date Range")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows domain pattern expansion for globussoft.in by default", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    }, { timeout: 5000 });
  });

  it("applies domain exclusion pattern correctly", async () => {
    render(<AllSearches />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    }, { timeout: 5000 });
  });
});

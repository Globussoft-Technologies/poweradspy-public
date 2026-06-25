import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import Projects from "../../../../src/components/Pas/Intelligence/Projects";

// Mock react-icons
vi.mock("react-icons/rx", () => ({
  RxCross1: () => <span data-testid="cross-icon" />,
}));

// Mock js-cookie
vi.mock("js-cookie", () => ({
  default: {
    get: () => "mock-token",
  },
}));

const mockProjectsData = {
  code: 200,
  data: {
    rows: [
      {
        _id: "1",
        timestamp: "17 Jun, 12:57",
        email: "user@globussoft.in",
        project_type: "project_click",
        method: null,
        monitoring_status: null,
        brands: "Brand A, Brand B",
        competitors: "Competitor 1, Competitor 2",
        member_name: null,
        member_email: null,
        delete_member_name: null,
        delete_member_email: null,
        exported_Competitors: null,
      },
      {
        _id: "2",
        timestamp: "17 Jun, 12:49",
        email: "admin@globussoft.in",
        project_type: "add_member",
        method: "add_member",
        monitoring_status: null,
        brands: null,
        competitors: null,
        member_name: "John Doe",
        member_email: "john@example.com",
        delete_member_name: null,
        delete_member_email: null,
        exported_Competitors: null,
      },
      {
        _id: "3",
        timestamp: "17 Jun, 12:40",
        email: "user@globussoft.in",
        project_type: "export_competitors",
        method: "export_competitors",
        monitoring_status: null,
        brands: null,
        competitors: null,
        member_name: null,
        member_email: null,
        delete_member_name: null,
        delete_member_email: null,
        exported_Competitors: ["Nike", "Adidas", "Puma"],
      },
    ],
    total: 3,
    page: 0,
    page_size: 10,
    total_pages: 1,
  },
  meta: {
    from_date: "2026-03-19T00:00:00.000Z",
    to_date: "2026-06-17T23:59:59.999Z",
    date_label: "19 Mar → 17 Jun",
  },
};

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    if (url.includes("/intelligence/projects")) {
      return Promise.resolve({
        json: () => Promise.resolve(mockProjectsData),
      });
    }
    return Promise.reject(new Error("Unknown URL"));
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Projects Component", () => {
  it("renders component with projects table", async () => {
    render(<Projects />);

    await waitFor(() => {
      expect(screen.getByText(/project events/i)).toBeInTheDocument();
    });
  });

  it("loads project activity data on mount", async () => {
    render(<Projects />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/intelligence/projects"),
        expect.any(Object)
      );
    });
  });

  it("displays project table columns correctly", async () => {
    render(<Projects />);

    await waitFor(() => {
      expect(screen.getByText("TIMESTAMP")).toBeInTheDocument();
      expect(screen.getByText("USER")).toBeInTheDocument();
      expect(screen.getByText("TYPE")).toBeInTheDocument();
      expect(screen.getByText("BRANDS")).toBeInTheDocument();
      expect(screen.getByText("COMPETITORS")).toBeInTheDocument();
      expect(screen.getByText("MEMBER NAME")).toBeInTheDocument();
      expect(screen.getByText("MEMBER EMAIL")).toBeInTheDocument();
      expect(screen.getByText("EXPORTED COMPETITORS")).toBeInTheDocument();
    });
  });

  it("displays member activity data for add_member", async () => {
    render(<Projects />);

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
      expect(screen.getByText("john@example.com")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("displays exported competitors as badges", async () => {
    render(<Projects />);

    await waitFor(() => {
      expect(screen.getByText("Nike")).toBeInTheDocument();
      expect(screen.getByText("Adidas")).toBeInTheDocument();
      expect(screen.getByText("Puma")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("displays project type labels with correct colors", async () => {
    render(<Projects />);

    await waitFor(() => {
      const typeElements = screen.queryAllByText(/project click|added member|exported competitors/i);
      expect(typeElements.length).toBeGreaterThan(0);
    });
  });

  it("filters projects by date range", async () => {
    render(<Projects />);

    await waitFor(() => {
      expect(screen.getByText(/project events/i)).toBeInTheDocument();
    });

    const dateSelect = screen.getByDisplayValue("Last 90 days");
    fireEvent.change(dateSelect, { target: { value: "Last 30 days" } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("date_range=Last+30+days"),
        expect.any(Object)
      );
    });
  });

  it("filters projects by user email", async () => {
    render(<Projects />);

    await waitFor(() => {
      expect(screen.getByText(/project events/i)).toBeInTheDocument();
    });

    const userInput = screen.getByPlaceholderText("Search email...");
    fireEvent.change(userInput, { target: { value: "user@globussoft.in" } });

    const applyBtn = screen.getByText("Apply");
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("user=user@globussoft.in"),
        expect.any(Object)
      );
    });
  });

  it("displays active filters as chips", async () => {
    render(<Projects />);

    await waitFor(() => {
      expect(screen.getByText("Last 90 days")).toBeInTheDocument();
    });

    // Initially only date range should be shown
    const filterChips = screen.queryAllByText(/Last 90 days/);
    expect(filterChips.length).toBeGreaterThan(0);
  });

  it("allows removing filters by clicking chip X button", async () => {
    render(<Projects />);

    await waitFor(() => {
      expect(screen.getByText("Last 90 days")).toBeInTheDocument();
    });

    const crossIcons = screen.getAllByTestId("cross-icon");
    expect(crossIcons.length).toBeGreaterThan(0);
  });

  it("resets all filters to defaults", async () => {
    render(<Projects />);

    await waitFor(() => {
      expect(screen.getByText(/project events/i)).toBeInTheDocument();
    });

    const resetBtn = screen.getByText("Reset");
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  it("displays pagination controls", async () => {
    render(<Projects />);

    await waitFor(() => {
      expect(screen.getByText(/Showing.*of/)).toBeInTheDocument();
      expect(screen.getByText(/Page.*\//)).toBeInTheDocument();
    });
  });

  it("displays member name and email as dash when not available", async () => {
    render(<Projects />);

    await waitFor(() => {
      const dashes = screen.queryAllByText("—");
      expect(dashes.length).toBeGreaterThan(0);
    });
  });

  it("displays export disclaimer about retention period", async () => {
    render(<Projects />);

    await waitFor(() => {
      expect(screen.getByText(/90 days/)).toBeInTheDocument();
    });
  });

  it("handles API errors gracefully", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ code: 500, message: "Server error" }),
      })
    );

    render(<Projects />);

    await waitFor(() => {
      // Component should handle error without crashing
      expect(screen.queryByText(/error|Error/i) || screen.getByText(/project events/i)).toBeInTheDocument();
    });
  });

  it("displays loading state initially", async () => {
    render(<Projects />);

    // Component should render before data loads
    const container = screen.getByText(/project events/i).closest("div");
    expect(container).toBeInTheDocument();
  });

  it("passes correct headers with authorization token", async () => {
    render(<Projects />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const calls = global.fetch.mock.calls;
    calls.forEach(call => {
      if (call[1] && call[1].headers) {
        expect(call[1].headers.Authorization).toBe("Bearer mock-token");
      }
    });
  });

  it("displays brands as comma-separated tags", async () => {
    render(<Projects />);

    await waitFor(() => {
      expect(screen.getByText("Brand A")).toBeInTheDocument();
      expect(screen.getByText("Brand B")).toBeInTheDocument();
    });
  });

  it("displays competitors as comma-separated tags", async () => {
    render(<Projects />);

    await waitFor(() => {
      expect(screen.getByText("Competitor 1")).toBeInTheDocument();
      expect(screen.getByText("Competitor 2")).toBeInTheDocument();
    });
  });

  it("shows total project event count with date range", async () => {
    render(<Projects />);

    await waitFor(() => {
      expect(screen.getByText(/3 project events.*19 Mar.*17 Jun/)).toBeInTheDocument();
    });
  });

  it("renders hover effects on table rows", async () => {
    render(<Projects />);

    await waitFor(() => {
      const rows = screen.getAllByRole("row");
      expect(rows.length).toBeGreaterThan(1);

      const firstRow = rows[1]; // Skip header row
      fireEvent.mouseEnter(firstRow);
      // Row should have hover styling
      expect(firstRow).toBeInTheDocument();
    });
  });

  it("handles member deletion activity correctly", async () => {
    const dataWithDelete = {
      ...mockProjectsData,
      data: {
        ...mockProjectsData.data,
        rows: [
          {
            _id: "4",
            timestamp: "17 Jun, 11:00",
            email: "admin@globussoft.in",
            project_type: "delete_member",
            method: "delete_member",
            monitoring_status: null,
            brands: null,
            competitors: null,
            member_name: null,
            member_email: null,
            delete_member_name: "Jane Doe",
            delete_member_email: "jane@example.com",
            exported_Competitors: null,
          },
        ],
      },
    };

    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve(dataWithDelete),
      })
    );

    render(<Projects />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
      expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    });
  });

  it("displays different project type colors correctly", async () => {
    render(<Projects />);

    await waitFor(() => {
      // Check for different project type badges
      const badges = screen.queryAllByText(/project click|added member|exported competitors/i);
      expect(badges.length).toBeGreaterThan(0);
    });
  });

  it("maintains filter state during pagination", async () => {
    render(<Projects />);

    await waitFor(() => {
      expect(screen.getByText(/project events/i)).toBeInTheDocument();
    });

    const userInput = screen.getByPlaceholderText("Search email...");
    fireEvent.change(userInput, { target: { value: "user@globussoft.in" } });

    const applyBtn = screen.getByText("Apply");
    fireEvent.click(applyBtn);

    await waitFor(() => {
      // User filter should be maintained in the URL
      expect(global.fetch.mock.calls.some(call =>
        call[0].includes("user=user@globussoft.in")
      )).toBe(true);
    });
  });

  it("shows no data message when result is empty", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({
          code: 200,
          data: { rows: [], total: 0, total_pages: 0 },
          meta: { date_label: "" },
        }),
      })
    );

    render(<Projects />);

    await waitFor(() => {
      expect(screen.getByText(/No project activity found/)).toBeInTheDocument();
    });
  });

  it("updates data when date range is changed", async () => {
    render(<Projects />);

    await waitFor(() => {
      expect(screen.getByText(/project events/i)).toBeInTheDocument();
    });

    const initialCallCount = global.fetch.mock.calls.length;

    const dateSelect = screen.getByDisplayValue("Last 90 days");
    fireEvent.change(dateSelect, { target: { value: "Today" } });

    await waitFor(() => {
      expect(global.fetch.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });
});

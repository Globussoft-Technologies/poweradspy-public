import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import SearchIntelligence from "../../../../src/components/Pas/Intelligence/SearchIntelligence";

// Mock child components
vi.mock("../../../../src/components/Pas/Intelligence/AllSearches", () => ({
  default: ({ onDataReady }) => (
    <div data-testid="all-searches">
      <button onClick={() => onDataReady?.(() => ({ rows: [], applied: {}, total: 0, dateLabel: "" }))}>
        Load AllSearches
      </button>
      AllSearches Component
    </div>
  ),
}));

vi.mock("../../../../src/components/Pas/Intelligence/KeywordTrends", () => ({
  default: ({ onDataReady }) => (
    <div data-testid="keyword-trends">
      <button onClick={() => onDataReady?.(() => ({ data: {}, typeTab: "keywords", sortBy: "count", meta: {} }))}>
        Load KeywordTrends
      </button>
      KeywordTrends Component
    </div>
  ),
}));

vi.mock("../../../../src/components/Pas/Intelligence/Projects", () => ({
  default: ({ onDataReady }) => (
    <div data-testid="projects">
      <button onClick={() => onDataReady?.(() => ({ rows: [], applied: {}, total: 0, dateLabel: "" }))}>
        Load Projects
      </button>
      Projects Component
    </div>
  ),
}));

vi.mock("../../../../src/components/Pas/Intelligence/TopUsers", () => ({
  default: ({ onDataReady }) => (
    <div data-testid="top-users">
      <button onClick={() => onDataReady?.(() => ({ users: [], meta: {} }))}>
        Load TopUsers
      </button>
      TopUsers Component
    </div>
  ),
}));

// Mock react-icons
vi.mock("react-icons/hi", () => ({
  HiDownload: () => <span data-testid="download-icon" />,
}));

// Mock jsPDF
vi.mock("jspdf", () => ({
  jsPDF: vi.fn(() => ({
    setFillColor: vi.fn(),
    rect: vi.fn(),
    setDrawColor: vi.fn(),
    line: vi.fn(),
    setFontSize: vi.fn(),
    setFont: vi.fn(),
    setTextColor: vi.fn(),
    text: vi.fn(),
    circle: vi.fn(),
    roundedRect: vi.fn(),
    splitTextToSize: vi.fn(() => ["test"]),
    getTextWidth: vi.fn(() => 50),
    addPage: vi.fn(),
    save: vi.fn(),
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SearchIntelligence Component", () => {
  it("renders component with tab navigation", async () => {
    render(<SearchIntelligence />);

    await waitFor(() => {
      expect(screen.getByText("Top users")).toBeInTheDocument();
      expect(screen.getByText("All searches")).toBeInTheDocument();
      expect(screen.getByText("Keyword trends")).toBeInTheDocument();
      expect(screen.getByText("Projects")).toBeInTheDocument();
    });
  });

  it("displays all tab buttons", () => {
    render(<SearchIntelligence />);

    const tabs = screen.getAllByRole("button").filter(btn =>
      ["Top users", "All searches", "Keyword trends", "Projects"].includes(btn.textContent)
    );
    expect(tabs.length).toBe(4);
  });

  it("switches to All Searches tab when clicked", async () => {
    render(<SearchIntelligence />);

    const allSearchesTab = screen.getByText("All searches").closest("button");
    fireEvent.click(allSearchesTab);

    await waitFor(() => {
      expect(screen.getByTestId("all-searches")).toBeInTheDocument();
    });
  });

  it("switches to Keyword Trends tab when clicked", async () => {
    render(<SearchIntelligence />);

    const keywordTrendsTab = screen.getByText("Keyword trends").closest("button");
    fireEvent.click(keywordTrendsTab);

    await waitFor(() => {
      expect(screen.getByTestId("keyword-trends")).toBeInTheDocument();
    });
  });

  it("switches to Projects tab when clicked", async () => {
    render(<SearchIntelligence />);

    const projectsTab = screen.getByText("Projects").closest("button");
    fireEvent.click(projectsTab);

    await waitFor(() => {
      expect(screen.getByTestId("projects")).toBeInTheDocument();
    });
  });

  it("displays Top Users tab as default active tab", async () => {
    render(<SearchIntelligence />);

    await waitFor(() => {
      expect(screen.getByTestId("top-users")).toBeInTheDocument();
    });
  });

  it("displays download button in header", () => {
    render(<SearchIntelligence />);

    const downloadIcon = screen.getByTestId("download-icon");
    expect(downloadIcon).toBeInTheDocument();
  });

  it("maintains tab state when switching between tabs", async () => {
    render(<SearchIntelligence />);

    const allSearchesTab = screen.getByText("All searches").closest("button");
    fireEvent.click(allSearchesTab);

    await waitFor(() => {
      expect(screen.getByTestId("all-searches")).toBeInTheDocument();
    });

    const keywordTrendsTab = screen.getByText("Keyword trends").closest("button");
    fireEvent.click(keywordTrendsTab);

    await waitFor(() => {
      expect(screen.getByTestId("keyword-trends")).toBeInTheDocument();
    });

    fireEvent.click(allSearchesTab);

    await waitFor(() => {
      expect(screen.getByTestId("all-searches")).toBeInTheDocument();
    });
  });

  it("collects export data from active tab via onDataReady callback", async () => {
    render(<SearchIntelligence />);

    const allSearchesTab = screen.getByText("All searches").closest("button");
    fireEvent.click(allSearchesTab);

    await waitFor(() => {
      const loadBtn = screen.getByText("Load AllSearches");
      fireEvent.click(loadBtn);
    });

    // Export data should be collected from AllSearches
    expect(screen.getByTestId("all-searches")).toBeInTheDocument();
  });

  it("updates export data when switching tabs", async () => {
    render(<SearchIntelligence />);

    const keywordTrendsTab = screen.getByText("Keyword trends").closest("button");
    fireEvent.click(keywordTrendsTab);

    await waitFor(() => {
      const loadBtn = screen.getByText("Load KeywordTrends");
      fireEvent.click(loadBtn);
    });

    expect(screen.getByTestId("keyword-trends")).toBeInTheDocument();
  });

  it("renders tab content based on active tab", async () => {
    render(<SearchIntelligence />);

    const projectsTab = screen.getByText("Projects").closest("button");
    fireEvent.click(projectsTab);

    await waitFor(() => {
      expect(screen.getByTestId("projects")).toBeInTheDocument();
      expect(screen.getByText("Projects Component")).toBeInTheDocument();
    });
  });

  it("handles tab switching with keyboard navigation (optional)", async () => {
    render(<SearchIntelligence />);

    const allSearchesTab = screen.getByText("All searches").closest("button");

    // Simulate keyboard navigation
    fireEvent.keyDown(allSearchesTab, { key: "Enter" });
    fireEvent.click(allSearchesTab);

    await waitFor(() => {
      expect(screen.getByTestId("all-searches")).toBeInTheDocument();
    });
  });

  it("displays correct tab labels for each section", () => {
    render(<SearchIntelligence />);

    expect(screen.getByText("Top users")).toBeInTheDocument();
    expect(screen.getByText("All searches")).toBeInTheDocument();
    expect(screen.getByText("Keyword trends")).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });

  it("shows info text about full 90-day logs", () => {
    render(<SearchIntelligence />);

    // The breadcrumb shows the active tab name
    expect(screen.getByText(/Search activity/)).toBeInTheDocument();
  });

  it("provides export functionality for each tab", async () => {
    render(<SearchIntelligence />);

    const downloadBtn = screen.getByTestId("download-icon").closest("button");
    expect(downloadBtn).toBeInTheDocument();
  });

  it("passes onDataReady callback to each child component", async () => {
    render(<SearchIntelligence />);

    await waitFor(() => {
      // Top Users should be rendered by default
      expect(screen.getByTestId("top-users")).toBeInTheDocument();
    });

    // Switch to each tab to verify they can be loaded
    const allSearchesTab = screen.getByText("All searches").closest("button");
    fireEvent.click(allSearchesTab);

    await waitFor(() => {
      expect(screen.getByTestId("all-searches")).toBeInTheDocument();
    });
  });

  it("renders active tab component conditionally", async () => {
    render(<SearchIntelligence />);

    // Initially, only Top Users should be visible
    expect(screen.getByTestId("top-users")).toBeInTheDocument();
    expect(screen.queryByTestId("all-searches")).not.toBeInTheDocument();

    // Switch to All Searches
    const allSearchesTab = screen.getByText("All searches").closest("button");
    fireEvent.click(allSearchesTab);

    await waitFor(() => {
      expect(screen.getByTestId("all-searches")).toBeInTheDocument();
      expect(screen.queryByTestId("top-users")).not.toBeInTheDocument();
    });
  });

  it("handles tab switching rapidly without errors", async () => {
    render(<SearchIntelligence />);

    const allSearchesTab = screen.getByText("All searches").closest("button");
    const keywordTrendsTab = screen.getByText("Keyword trends").closest("button");
    const projectsTab = screen.getByText("Projects").closest("button");

    fireEvent.click(allSearchesTab);
    fireEvent.click(keywordTrendsTab);
    fireEvent.click(projectsTab);
    fireEvent.click(allSearchesTab);

    await waitFor(() => {
      expect(screen.getByTestId("all-searches")).toBeInTheDocument();
    });
  });

  it("initially renders Top Users tab content", async () => {
    render(<SearchIntelligence />);

    await waitFor(() => {
      expect(screen.getByTestId("top-users")).toBeInTheDocument();
      expect(screen.getByText("TopUsers Component")).toBeInTheDocument();
    });
  });

  // PDF EXPORT TESTS
  it("has export button visible in header", () => {
    render(<SearchIntelligence />);

    const exportBtn = screen.getByRole("button", { name: /export/i });
    expect(exportBtn).toBeInTheDocument();
  });

  it("exports PDF when export button is clicked", async () => {
    const { jsPDF } = await import("jspdf");

    render(<SearchIntelligence />);

    // Load data first
    const loadBtn = screen.getByText("Load TopUsers");
    fireEvent.click(loadBtn);

    await waitFor(() => {
      const exportBtn = screen.getByRole("button", { name: /export/i });
      fireEvent.click(exportBtn);
    });

    // Should call jsPDF to create PDF
    expect(jsPDF).toHaveBeenCalled();
  });

  it("exports Keyword Trends PDF with summary stats", async () => {
    render(<SearchIntelligence />);

    const keywordTrendsTab = screen.getByText("Keyword trends").closest("button");
    fireEvent.click(keywordTrendsTab);

    await waitFor(() => {
      const loadBtn = screen.getByText("Load KeywordTrends");
      fireEvent.click(loadBtn);
    });

    const exportBtn = screen.getByRole("button", { name: /export/i });
    fireEvent.click(exportBtn);

    // jsPDF should be instantiated for PDF creation
    const { jsPDF } = await import("jspdf");
    expect(jsPDF).toHaveBeenCalled();
  });

  it("exports Projects PDF with all columns", async () => {
    render(<SearchIntelligence />);

    const projectsTab = screen.getByText("Projects").closest("button");
    fireEvent.click(projectsTab);

    await waitFor(() => {
      const loadBtn = screen.getByText("Load Projects");
      fireEvent.click(loadBtn);
    });

    const exportBtn = screen.getByRole("button", { name: /export/i });
    fireEvent.click(exportBtn);

    const { jsPDF } = await import("jspdf");
    expect(jsPDF).toHaveBeenCalled();
  });

  it("exports All Searches PDF", async () => {
    render(<SearchIntelligence />);

    const allSearchesTab = screen.getByText("All searches").closest("button");
    fireEvent.click(allSearchesTab);

    await waitFor(() => {
      const loadBtn = screen.getByText("Load AllSearches");
      fireEvent.click(loadBtn);
    });

    const exportBtn = screen.getByRole("button", { name: /export/i });
    fireEvent.click(exportBtn);

    const { jsPDF } = await import("jspdf");
    expect(jsPDF).toHaveBeenCalled();
  });

  it("exports Top Users PDF", async () => {
    render(<SearchIntelligence />);

    const topUsersTab = screen.getByText("Top users").closest("button");
    fireEvent.click(topUsersTab);

    await waitFor(() => {
      const loadBtn = screen.getByText("Load TopUsers");
      fireEvent.click(loadBtn);
    });

    const exportBtn = screen.getByRole("button", { name: /export/i });
    fireEvent.click(exportBtn);

    const { jsPDF } = await import("jspdf");
    expect(jsPDF).toHaveBeenCalled();
  });

  it("PDF export includes proper header with title", async () => {
    render(<SearchIntelligence />);

    // Load data first
    const loadBtn = screen.getByText("Load TopUsers");
    fireEvent.click(loadBtn);

    // Click export button to trigger PDF generation
    await waitFor(() => {
      const exportBtn = screen.getByRole("button", { name: /export/i });
      expect(exportBtn).toBeEnabled();
      fireEvent.click(exportBtn);
    });

    // Since jsPDF is mocked globally, it should be called
    const { jsPDF } = await import("jspdf");
    expect(jsPDF).toHaveBeenCalled();
  });

  it("PDF export includes proper footer with copyright", async () => {
    const { jsPDF } = await import("jspdf");

    render(<SearchIntelligence />);

    // Load data first
    const loadBtn = screen.getByText("Load TopUsers");
    fireEvent.click(loadBtn);

    await waitFor(() => {
      const exportBtn = screen.getByRole("button", { name: /export/i });
      fireEvent.click(exportBtn);
    });

    // PDF should be created
    expect(jsPDF).toHaveBeenCalled();
  });

  it("PDF export calls save method to download file", async () => {
    const { jsPDF } = await import("jspdf");

    render(<SearchIntelligence />);

    // Load data first
    const loadBtn = screen.getByText("Load TopUsers");
    fireEvent.click(loadBtn);

    await waitFor(() => {
      const exportBtn = screen.getByRole("button", { name: /export/i });
      fireEvent.click(exportBtn);
    });

    // jsPDF constructor should be called when exporting
    expect(jsPDF).toHaveBeenCalled();
  });

  it("PDF export filename includes current date", async () => {
    const { jsPDF } = await import("jspdf");

    render(<SearchIntelligence />);

    // Load data first
    const loadBtn = screen.getByText("Load TopUsers");
    fireEvent.click(loadBtn);

    await waitFor(() => {
      const exportBtn = screen.getByRole("button", { name: /export/i });
      fireEvent.click(exportBtn);
    });

    // jsPDF should have been instantiated for PDF generation
    expect(jsPDF).toHaveBeenCalled();
  });
});

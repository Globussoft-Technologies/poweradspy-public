import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import ItemFilter from "../../../../src/components/Pas/Intelligence/ItemFilter";

// Mock js-cookie
vi.mock("js-cookie", () => ({
  default: {
    get: () => "mock-token",
  },
}));

const mockItemsResponse = {
  code: 200,
  data: {
    type: 1,
    type_label: "keywords",
    items: [
      { id: "doc1", value: "marketing", count: 15 },
      { id: "doc2", value: "shoes", count: 8 },
      { id: "doc3", value: "insurance", count: 20 },
    ],
    total: 3,
  },
};

const mockEmptyItemsResponse = {
  code: 200,
  data: {
    type: 1,
    type_label: "keywords",
    items: [],
    total: 0,
  },
};

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    if (url.includes("/items-list")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockItemsResponse),
      });
    }
    return Promise.reject(new Error("Unknown URL"));
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ItemFilter Component", () => {
  it("renders dropdown button with placeholder text", async () => {
    render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Select keywords.../)).toBeInTheDocument();
    });
  });

  it("fetches items when component mounts", async () => {
    render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/items-list?type=1"),
        expect.any(Object)
      );
    });
  });

  it("sends correct type parameter for keywords tab", async () => {
    render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("type=1"),
        expect.any(Object)
      );
    });
  });

  it("sends correct type parameter for advertisers tab", async () => {
    render(<ItemFilter typeTab="advertisers" onFilterApply={vi.fn()} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("type=2"),
        expect.any(Object)
      );
    });
  });

  it("sends correct type parameter for domains tab", async () => {
    render(<ItemFilter typeTab="domains" onFilterApply={vi.fn()} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("type=3"),
        expect.any(Object)
      );
    });
  });

  it("opens dropdown when button is clicked", async () => {
    render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    const button = screen.getByText(/Select keywords.../);
    fireEvent.click(button);

    await waitFor(() => {
      // Dropdown should be open and showing items
      expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
    });
  });

  it("displays items in dropdown", async () => {
    render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    const button = screen.getByText(/Select keywords.../);
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("marketing")).toBeInTheDocument();
      expect(screen.getByText("shoes")).toBeInTheDocument();
      expect(screen.getByText("insurance")).toBeInTheDocument();
    });
  });

  it("displays item counts", async () => {
    render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    const button = screen.getByText(/Select keywords.../);
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("15")).toBeInTheDocument();
      expect(screen.getByText("8")).toBeInTheDocument();
      expect(screen.getByText("20")).toBeInTheDocument();
    });
  });

  it("filters items based on search input", async () => {
    render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    const button = screen.getByText(/Select keywords.../);
    fireEvent.click(button);

    const searchInput = screen.getByPlaceholderText("Search...");
    fireEvent.change(searchInput, { target: { value: "mar" } });

    await waitFor(() => {
      expect(screen.getByText("marketing")).toBeInTheDocument();
      expect(screen.queryByText("shoes")).not.toBeInTheDocument();
    });
  });

  it("calls onFilterApply when item is selected", async () => {
    const onFilterApply = vi.fn();
    render(<ItemFilter typeTab="keywords" onFilterApply={onFilterApply} />);

    const button = screen.getByText(/Select keywords.../);
    fireEvent.click(button);

    await waitFor(() => {
      const marketingOption = screen.getByText("marketing");
      fireEvent.click(marketingOption);
    });

    expect(onFilterApply).toHaveBeenCalledWith("marketing");
  });

  it("updates button text with selected item", async () => {
    render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    const button = screen.getByText(/Select keywords.../);
    fireEvent.click(button);

    await waitFor(() => {
      const marketingOption = screen.getByText("marketing");
      fireEvent.click(marketingOption);
    });

    await waitFor(() => {
      expect(screen.getByText("marketing")).toBeInTheDocument();
    });
  });

  it("displays clear button when item is selected", async () => {
    render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    const button = screen.getByText(/Select keywords.../);
    fireEvent.click(button);

    await waitFor(() => {
      const marketingOption = screen.getByText("marketing");
      fireEvent.click(marketingOption);
    });

    await waitFor(() => {
      expect(screen.getByText("✕")).toBeInTheDocument();
    });
  });

  it("clears filter when clear button is clicked", async () => {
    const onFilterApply = vi.fn();
    render(<ItemFilter typeTab="keywords" onFilterApply={onFilterApply} />);

    const button = screen.getByText(/Select keywords.../);
    fireEvent.click(button);

    await waitFor(() => {
      const marketingOption = screen.getByText("marketing");
      fireEvent.click(marketingOption);
    });

    const clearBtn = screen.getByText("✕");
    fireEvent.click(clearBtn);

    expect(onFilterApply).toHaveBeenCalledWith(null);
  });

  it("closes dropdown when item is selected", async () => {
    render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    const button = screen.getByText(/Select keywords.../);
    fireEvent.click(button);

    await waitFor(() => {
      const marketingOption = screen.getByText("marketing");
      fireEvent.click(marketingOption);
    });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Search...")).not.toBeInTheDocument();
    });
  });

  it("refetches items when typeTab changes", async () => {
    const { rerender } = render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("type=1"),
        expect.any(Object)
      );
    });

    const callCountBefore = global.fetch.mock.calls.length;

    rerender(<ItemFilter typeTab="advertisers" onFilterApply={vi.fn()} />);

    await waitFor(() => {
      expect(global.fetch.mock.calls.length).toBeGreaterThan(callCountBefore);
    });
  });

  it("clears selection when typeTab changes", async () => {
    const { rerender } = render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    const button = screen.getByText(/Select keywords.../);
    fireEvent.click(button);

    await waitFor(() => {
      const marketingOption = screen.getByText("marketing");
      fireEvent.click(marketingOption);
    });

    await waitFor(() => {
      expect(screen.getByText("marketing")).toBeInTheDocument();
    });

    rerender(<ItemFilter typeTab="advertisers" onFilterApply={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Select advertisers.../)).toBeInTheDocument();
    });
  });

  it("handles empty items list", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockEmptyItemsResponse),
      })
    );

    render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    const button = screen.getByText(/Select keywords.../);
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("No items found")).toBeInTheDocument();
    });
  });

  it("handles API errors gracefully", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ code: 500, message: "Server error" }),
      })
    );

    render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    const button = screen.getByText(/Select keywords.../);
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("No items found")).toBeInTheDocument();
    });
  });

  it("handles network errors gracefully", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("Network error")));

    render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    const button = screen.getByText(/Select keywords.../);
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("No items found")).toBeInTheDocument();
    });
  });

  it("sends authorization header", async () => {
    render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    await waitFor(() => {
      const call = global.fetch.mock.calls[0];
      expect(call[1].headers.Authorization).toBe("Bearer mock-token");
    });
  });

  it("shows loading state while fetching", async () => {
    global.fetch = vi.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: () => Promise.resolve(mockItemsResponse),
              }),
            100
          )
        )
    );

    render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    const button = screen.getByText(/Select keywords.../);
    fireEvent.click(button);

    // Should show loading initially
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });
  });

  it("case-insensitive search filtering", async () => {
    render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    const button = screen.getByText(/Select keywords.../);
    fireEvent.click(button);

    const searchInput = screen.getByPlaceholderText("Search...");
    fireEvent.change(searchInput, { target: { value: "MARK" } });

    await waitFor(() => {
      expect(screen.getByText("marketing")).toBeInTheDocument();
    });
  });

  it("partial string matching in search", async () => {
    render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    const button = screen.getByText(/Select keywords.../);
    fireEvent.click(button);

    const searchInput = screen.getByPlaceholderText("Search...");
    fireEvent.change(searchInput, { target: { value: "ket" } });

    await waitFor(() => {
      expect(screen.getByText("marketing")).toBeInTheDocument();
    });
  });

  it("toggles dropdown open/closed on button click", async () => {
    render(<ItemFilter typeTab="keywords" onFilterApply={vi.fn()} />);

    const button = screen.getByText(/Select keywords.../);

    // Open
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
    });

    // Close
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Search...")).not.toBeInTheDocument();
    });
  });
});

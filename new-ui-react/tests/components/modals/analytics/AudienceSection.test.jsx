import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  Heart: () => <i data-testid="heart-ic" />,
  Zap: () => <i data-testid="zap-ic" />,
  Copy: () => <i data-testid="copy-ic" />,
  Users: () => <i data-testid="users-ic" />,
}));

const useThemeMock = vi.fn(() => ({ theme: "dark" }));
vi.mock("../../../../src/hooks/useTheme", () => ({ useTheme: () => useThemeMock() }));

import AudienceSection from "../../../../src/components/modals/analytics/AudienceSection.jsx";

describe("AudienceSection", () => {
  it("returns null when adDetails is non-null but has no data", () => {
    const { container } = render(<AudienceSection adDetails={{}} />);
    expect(container.innerHTML).toBe("");
  });
  it("adDetails=null → shows 'Loading...'", () => {
    const { getByText } = render(<AudienceSection adDetails={null} />);
    expect(getByText("Loading...")).toBeInTheDocument();
  });
  it("renders 'Target Audience' heading + interests/behaviour sections", () => {
    const { getByText } = render(
      <AudienceSection adDetails={{ interests: ["Sports"], behaviours: ["Active"] }} />,
    );
    expect(getByText("Target Audience")).toBeInTheDocument();
    expect(getByText("INTERESTS")).toBeInTheDocument();
    expect(getByText("BEHAVIOUR")).toBeInTheDocument();
  });
  it("non-array interests/behaviours coerced to single-element array", () => {
    const { getByText } = render(
      <AudienceSection adDetails={{ interests: "Music" }} />,
    );
    expect(getByText("Music")).toBeInTheDocument();
  });
  it("non-array behaviours coerced to single-element array (line 12 fallback)", () => {
    const { getByText } = render(
      <AudienceSection adDetails={{ interests: ["I"], behaviours: "RunningBeh" }} />,
    );
    expect(getByText("RunningBeh")).toBeInTheDocument();
  });
  it("isLight + multi-category render exercises both-mid + last-row border branches", () => {
    useThemeMock.mockReturnValueOnce({ theme: "light" });
    const { container } = render(
      <AudienceSection adDetails={{ interests: ["A", "B"], behaviours: ["X"] }} />,
    );
    // both INTERESTS and BEHAVIOUR sections render → mid-row + last-row branches both fire
    expect(container.innerHTML).toMatch(/bg-gray-50/);
  });
  it("only-interests data → behaviour section hidden", () => {
    const { queryByText } = render(
      <AudienceSection adDetails={{ interests: ["X"] }} />,
    );
    expect(queryByText("BEHAVIOUR")).toBeNull();
  });
  it("Copy button uses navigator.clipboard.writeText", () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true, value: { writeText },
    });
    const { getAllByTestId } = render(
      <AudienceSection adDetails={{ interests: ["A", "B"] }} />,
    );
    fireEvent.click(getAllByTestId("copy-ic")[1].closest("button"));
    expect(writeText).toHaveBeenCalledWith("B");
  });
  it("isLight=true (theme='light') uses light styles", () => {
    useThemeMock.mockReturnValueOnce({ theme: "light" });
    const { container } = render(
      <AudienceSection adDetails={{ interests: ["X"] }} />,
    );
    expect(container.innerHTML).toMatch(/bg-gray-50/);
  });
  it("loading + isLight uses light placeholder styles", () => {
    useThemeMock.mockReturnValueOnce({ theme: "light" });
    const { container } = render(<AudienceSection adDetails={null} />);
    expect(container.innerHTML).toMatch(/bg-gray-50/);
  });
});

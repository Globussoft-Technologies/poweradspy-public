import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  Sparkles: () => <i data-testid="sparkles-ic" />,
  X: () => <i data-testid="x-ic" />,
  Loader2: () => <i data-testid="loader-ic" />,
}));

import AIAnalysisModal from "../../../src/components/modals/AIAnalysisModal.jsx";

describe("AIAnalysisModal", () => {
  it("returns null when ad is falsy", () => {
    const { container } = render(<AIAnalysisModal ad={null} onClose={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
  it("renders heading + analyzing loader", () => {
    const { getByText, getByTestId } = render(
      <AIAnalysisModal ad={{ id: 1 }} isAnalyzing={true} onClose={() => {}} />,
    );
    expect(getByText("AI Strategy Audit")).toBeInTheDocument();
    expect(getByTestId("loader-ic")).toBeInTheDocument();
    expect(getByText("Decoding ad psychology...")).toBeInTheDocument();
  });
  it("renders the analysis text when not analyzing", () => {
    const { getByText, queryByTestId } = render(
      <AIAnalysisModal ad={{ id: 1 }} analysis="Here's the insight" onClose={() => {}} />,
    );
    expect(getByText("Here's the insight")).toBeInTheDocument();
    expect(queryByTestId("loader-ic")).toBeNull();
  });
  it("X button calls onClose", () => {
    const onClose = vi.fn();
    const { getByTestId } = render(
      <AIAnalysisModal ad={{ id: 1 }} onClose={onClose} />,
    );
    fireEvent.click(getByTestId("x-ic").closest("button"));
    expect(onClose).toHaveBeenCalled();
  });
});

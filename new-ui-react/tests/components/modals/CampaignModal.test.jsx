import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  BrainCircuit: () => <i data-testid="brain-ic" />,
  X: () => <i data-testid="x-ic" />,
  Loader2: () => <i data-testid="loader-ic" />,
}));

import CampaignModal from "../../../src/components/modals/CampaignModal.jsx";

describe("CampaignModal", () => {
  it("returns null when isOpen=false", () => {
    const { container } = render(<CampaignModal isOpen={false} onClose={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
  it("renders heading + generating loader", () => {
    const { getByText, getByTestId } = render(
      <CampaignModal isOpen isGenerating onClose={() => {}} />,
    );
    expect(getByText("Campaign Strategy Genie")).toBeInTheDocument();
    expect(getByTestId("loader-ic")).toBeInTheDocument();
    expect(getByText("Building 30-Day Masterplan...")).toBeInTheDocument();
  });
  it("renders the strategy text when not generating", () => {
    const { getByText, queryByTestId } = render(
      <CampaignModal isOpen strategy="Plan: do X then Y" onClose={() => {}} />,
    );
    expect(getByText("Plan: do X then Y")).toBeInTheDocument();
    expect(queryByTestId("loader-ic")).toBeNull();
  });
  it("X button calls onClose", () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<CampaignModal isOpen onClose={onClose} />);
    fireEvent.click(getByTestId("x-ic").closest("button"));
    expect(onClose).toHaveBeenCalled();
  });
});

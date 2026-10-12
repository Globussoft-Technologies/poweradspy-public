import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AiSearchExplanation,
  AiSearchToast,
} from "../../../src/components/ads/AiSearchNotices";

describe("AiSearchExplanation", () => {
  it("renders nothing when there is no explanation to show", () => {
    const { container } = render(<AiSearchExplanation />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a failed prompt as an unapplied state, not as the planner summary", () => {
    const onDismiss = vi.fn();
    render(
      <AiSearchExplanation
        failureMessage="I cannot list all filters under a category."
        summary="Planner summary that duplicates the reason"
        onDismiss={onDismiss}
      />,
    );

    expect(
      screen.getByRole("region", { name: "AI prompt not applied" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Couldn't apply your prompt")).toBeInTheDocument();
    expect(
      screen.getByText("I cannot list all filters under a category."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Planner summary that duplicates the reason"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss AI search explanation" }),
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows the executed plan's summary and note when the prompt was applied", () => {
    render(
      <AiSearchExplanation
        summary="Searched: fitness apps for women in the US"
        note="Some networks do not support this filter."
      />,
    );

    expect(
      screen.getByRole("region", { name: "AI search explanation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Searched: fitness apps for women in the US"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Some networks do not support this filter."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Couldn't apply your prompt"),
    ).not.toBeInTheDocument();
  });

  it("keeps the suggestions in their own group under the text", () => {
    render(
      <AiSearchExplanation
        failureMessage="I cannot list all filters under a category."
        suggestions={[{ prompt: "weight loss ads in the US" }]}
      />,
    );

    const group = screen.getByRole("group", { name: "Did you mean suggestions" });
    const text = screen.getByText("I cannot list all filters under a category.");
    // The chips must not share a row with the message text.
    expect(group.contains(text)).toBe(false);
    expect(text.closest("p")?.contains(group)).toBe(false);
  });

  it("runs a suggested prompt after clearing the previous suggestions", () => {
    const onSuggestionSelect = vi.fn();
    const onSuggestionsDismiss = vi.fn();
    render(
      <AiSearchExplanation
        failureMessage="I cannot list all filters under a category."
        suggestions={[{ prompt: "weight loss ads in the US" }]}
        onSuggestionSelect={onSuggestionSelect}
        onSuggestionsDismiss={onSuggestionsDismiss}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Run suggested search: weight loss ads in the US",
      }),
    );

    expect(onSuggestionsDismiss).toHaveBeenCalledTimes(1);
    expect(onSuggestionSelect).toHaveBeenCalledWith("weight loss ads in the US");
  });
});

describe("AiSearchToast", () => {
  it("renders nothing without a message", () => {
    const { container } = render(<AiSearchToast toast={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("announces the outcome with a quiet surface", () => {
    render(
      <AiSearchToast
        toast={{
          message: "Couldn't apply your prompt. Showing all ads.",
          type: "unapplied",
        }}
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Couldn't apply your prompt. Showing all ads.");
    expect(status).toHaveClass("bg-theme-card", "border-theme-border");
  });

  it("can be removed with its close button", () => {
    const onDismiss = vi.fn();
    render(
      <AiSearchToast
        toast={{ message: "Couldn't apply your prompt. Showing all ads.", type: "unapplied" }}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("centres on the viewport rather than on the feed column", () => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 1000,
    });
    render(
      <div data-testid="column">
        <AiSearchToast
          toast={{ message: "Couldn't apply your prompt. Showing all ads.", type: "unapplied" }}
        />
      </div>,
    );

    // A 200px sidebar leaves the feed column at 200-1000px. Its centre (600) sits
    // 100px right of the viewport centre (500).
    const column = screen.getByTestId("column");
    column.getBoundingClientRect = () => ({
      left: 200,
      right: 1000,
      width: 800,
      top: 0,
      bottom: 0,
      x: 200,
      y: 0,
      height: 0,
      toJSON: () => {},
    });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(column.firstElementChild.style.transform).toBe("translateX(-100px)");
    // 300px of room either side of the viewport centre, less an 8px gap at the sidebar.
    expect(screen.getByRole("status").style.maxWidth).toBe("584px");
    delete document.documentElement.clientWidth;
  });

  it("centres within the feed column when the sidebar leaves no room to centre on the screen", () => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 500,
    });
    render(
      <div data-testid="column">
        <AiSearchToast
          toast={{ message: "Couldn't apply your prompt. Showing all ads.", type: "unapplied" }}
        />
      </div>,
    );

    // A 200px sidebar leaves a 300px column. Only 50px sit between the viewport
    // centre (250) and the sidebar edge, so the notice stays inside the column.
    const column = screen.getByTestId("column");
    column.getBoundingClientRect = () => ({
      left: 200,
      right: 500,
      width: 300,
      top: 0,
      bottom: 0,
      x: 200,
      y: 0,
      height: 0,
      toJSON: () => {},
    });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(column.firstElementChild.style.transform).toBe("translateX(0px)");
    expect(screen.getByRole("status").style.maxWidth).toBe("284px");
    delete document.documentElement.clientWidth;
  });

  it("overlays the results under the filters without taking layout space", () => {
    const { container } = render(
      <AiSearchToast
        toast={{ message: "Couldn't apply your prompt. Showing all ads.", type: "unapplied" }}
      />,
    );

    const overlay = container.firstElementChild;
    expect(overlay).toHaveClass("absolute", "top-full");
    expect(overlay).not.toHaveClass("mb-3", "fixed", "bottom-16");
  });
});

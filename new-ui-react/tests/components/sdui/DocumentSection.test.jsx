import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  ChevronDown: () => <i data-testid="cdown-ic" />,
}));
vi.mock("../../../src/components/sdui/SDUIIcon", () => ({
  default: ({ icon, size }) => <i data-testid="sdui-icon" data-type={icon?.type} data-size={size} />,
}));

import DocumentSection from "../../../src/components/sdui/DocumentSection.jsx";

const DOC = { title: "Filters", icon: { type: "svg", value: "<x/>" } };

describe("DocumentSection", () => {
  it("returns null when doc is falsy", () => {
    const { container } = render(<DocumentSection document={null}>kids</DocumentSection>);
    expect(container.innerHTML).toBe("");
  });
  it("renders title (lowercased text)", () => {
    const { getByText } = render(
      <DocumentSection document={DOC}><div>child</div></DocumentSection>,
    );
    expect(getByText("filters")).toBeInTheDocument();
  });
  it("preserves the AI acronym in normalized titles", () => {
    const { getByText } = render(
      <DocumentSection document={{ title: "META AI" }}>child</DocumentSection>,
    );
    expect(getByText("meta AI")).toBeInTheDocument();
  });
  it("renders SDUIIcon when icon.type is not 'none'", () => {
    const { getByTestId } = render(
      <DocumentSection document={DOC}>x</DocumentSection>,
    );
    expect(getByTestId("sdui-icon").getAttribute("data-type")).toBe("svg");
  });
  it("omits icon when doc.icon is missing", () => {
    const { queryByTestId } = render(
      <DocumentSection document={{ title: "X" }}>x</DocumentSection>,
    );
    expect(queryByTestId("sdui-icon")).toBeNull();
  });
  it("omits icon when icon.type='none'", () => {
    const { queryByTestId } = render(
      <DocumentSection document={{ title: "X", icon: { type: "none" } }}>x</DocumentSection>,
    );
    expect(queryByTestId("sdui-icon")).toBeNull();
  });
  it("starts collapsed (max-h-0)", () => {
    const { container } = render(
      <DocumentSection document={DOC}>x</DocumentSection>,
    );
    expect(container.querySelector("div.max-h-0")).not.toBeNull();
  });
  it("clicking toggle expands, then collapses", () => {
    const { getByRole, container } = render(
      <DocumentSection document={DOC}>x</DocumentSection>,
    );
    fireEvent.click(getByRole("button"));
    expect(container.querySelector("div.max-h-\\[300px\\]")).not.toBeNull();
    fireEvent.click(getByRole("button"));
    expect(container.querySelector("div.max-h-0")).not.toBeNull();
  });
  it("expand schedules scrollIntoView after 220ms", () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { getByRole } = render(
      <DocumentSection document={DOC}>x</DocumentSection>,
    );
    fireEvent.click(getByRole("button"));
    act(() => { vi.advanceTimersByTime(220); });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
    vi.useRealTimers();
  });
  it("collapse does NOT schedule scrollIntoView", () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { getByRole } = render(
      <DocumentSection document={DOC}>x</DocumentSection>,
    );
    fireEvent.click(getByRole("button")); // expand
    act(() => { vi.advanceTimersByTime(220); });
    scrollIntoView.mockClear();
    fireEvent.click(getByRole("button")); // collapse
    act(() => { vi.advanceTimersByTime(500); });
    expect(scrollIntoView).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  it("doc.title undefined → empty title rendered", () => {
    const { container } = render(
      <DocumentSection document={{ icon: { type: "none" } }}>x</DocumentSection>,
    );
    // Component still renders without crashing
    expect(container.innerHTML).toContain("button");
  });
});

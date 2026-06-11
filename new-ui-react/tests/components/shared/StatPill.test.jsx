import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import StatPill from "../../../src/components/shared/StatPill.jsx";

describe("StatPill", () => {
  it("renders icon and value", () => {
    const { getByText } = render(<StatPill icon={<span>I</span>} value={42} />);
    expect(getByText("42")).toBeInTheDocument();
    expect(getByText("I")).toBeInTheDocument();
  });
  it("no tooltip → tooltip span omitted", () => {
    const { container } = render(<StatPill icon={<span>I</span>} value={42} />);
    expect(container.querySelectorAll("span").length).toBe(2);
  });
  it("tooltip rendered when provided", () => {
    const { getByText } = render(<StatPill icon={<span>I</span>} value={42} tooltip="Hello" />);
    expect(getByText("Hello")).toBeInTheDocument();
  });
  it("tooltipAlign='right' applies right-0 class", () => {
    const { getByText } = render(<StatPill icon={<span>I</span>} value={1} tooltip="t" tooltipAlign="right" />);
    expect(getByText("t").className).toMatch(/right-0/);
  });
  it("tooltipAlign='left' applies left-0 class", () => {
    const { getByText } = render(<StatPill icon={<span>I</span>} value={1} tooltip="t" tooltipAlign="left" />);
    expect(getByText("t").className).toMatch(/left-0/);
  });
  it("tooltipAlign default = center → -translate-x-1/2", () => {
    const { getByText } = render(<StatPill icon={<span>I</span>} value={1} tooltip="t" />);
    expect(getByText("t").className).toMatch(/-translate-x-1\/2/);
  });
});

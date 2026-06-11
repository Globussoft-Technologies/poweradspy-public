import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import NavItem from "../../../src/components/shared/NavItem.jsx";

describe("NavItem", () => {
  it("renders label + icon", () => {
    const { getByText } = render(<NavItem icon={<span>I</span>} label="Home" />);
    expect(getByText("Home")).toBeInTheDocument();
    expect(getByText("I")).toBeInTheDocument();
  });
  it("clicking fires onClick", () => {
    const onClick = vi.fn();
    const { getByRole } = render(<NavItem icon={<span>I</span>} label="Home" onClick={onClick} />);
    fireEvent.click(getByRole("button"));
    expect(onClick).toHaveBeenCalled();
  });
  it("active state applies active styles", () => {
    const { getByRole } = render(<NavItem icon={<span>I</span>} label="Home" active />);
    expect(getByRole("button").className).toMatch(/bg-theme-text/);
  });
  it("inactive: no bg-theme-text class", () => {
    const { getByRole } = render(<NavItem icon={<span>I</span>} label="Home" />);
    expect(getByRole("button").className).not.toMatch(/bg-theme-text\/\[0\.06\]/);
  });
  it("collapsed: label hidden + title attr set", () => {
    const { queryByText, getByRole } = render(
      <NavItem icon={<span>I</span>} label="Home" collapsed />,
    );
    expect(queryByText("Home")).toBeNull();
    expect(getByRole("button").getAttribute("title")).toBe("Home");
  });
  it("expanded: title attr is undefined", () => {
    const { getByRole } = render(<NavItem icon={<span>I</span>} label="Home" />);
    expect(getByRole("button").getAttribute("title")).toBeNull();
  });
});

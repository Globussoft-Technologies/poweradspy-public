import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("../../../src/components/sdui/SDUIIcon", () => ({
  default: ({ icon, size }) => <i data-testid="sdui-icon" data-type={icon.type} data-size={size} />,
}));

import PlatformToggle from "../../../src/components/filters/PlatformToggle.jsx";

describe("PlatformToggle", () => {
  it("renders label when provided", () => {
    const { getByText } = render(
      <PlatformToggle label="Platforms" options={["FB"]} selected={["FB"]} onChange={() => {}} />,
    );
    expect(getByText("Platforms")).toBeInTheDocument();
  });
  it("omits label when not provided", () => {
    const { container } = render(<PlatformToggle options={["FB"]} selected={[]} onChange={() => {}} />);
    expect(container.querySelector("span.uppercase.tracking-widest")).toBeNull();
  });
  it("renders an SDUIIcon when option has icon_url or icon_type", () => {
    const { getByTestId } = render(
      <PlatformToggle options={[{ value: "fb", label: "FB", icon_url: "x", icon_type: "svg" }]}
        selected={[]} onChange={() => {}} />,
    );
    expect(getByTestId("sdui-icon").getAttribute("data-type")).toBe("svg");
  });
  it("defaults icon_type to 'svg' when only icon_url present", () => {
    const { getByTestId } = render(
      <PlatformToggle options={[{ value: "fb", label: "FB", icon_url: "x" }]}
        selected={[]} onChange={() => {}} />,
    );
    expect(getByTestId("sdui-icon").getAttribute("data-type")).toBe("svg");
  });
  it("icon_url empty + icon_type present → SDUIIcon renders with empty value", () => {
    const { getByTestId } = render(
      <PlatformToggle options={[{ value: "fb", label: "FB", icon_type: "lucide" }]}
        selected={[]} onChange={() => {}} />,
    );
    expect(getByTestId("sdui-icon").getAttribute("data-type")).toBe("lucide");
  });
  it("no icon when neither url nor type", () => {
    const { queryByTestId } = render(
      <PlatformToggle options={[{ value: "fb", label: "FB" }]} selected={[]} onChange={() => {}} />,
    );
    expect(queryByTestId("sdui-icon")).toBeNull();
  });
  it("active option styled with bg-[#335296]/20", () => {
    const { getAllByRole } = render(
      <PlatformToggle options={["A", "B"]} selected={["A"]} onChange={() => {}} />,
    );
    expect(getAllByRole("button")[0].className).toMatch(/335296/);
    expect(getAllByRole("button")[1].className).not.toMatch(/335296/);
  });
  it("multiSelect=true: adds to existing selection", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <PlatformToggle options={["A", "B"]} selected={["A"]} onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[1]);
    expect(onChange).toHaveBeenCalledWith(["A", "B"]);
  });
  it("multiSelect=true: removes selected entry", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <PlatformToggle options={["A", "B"]} selected={["A", "B"]} onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[0]);
    expect(onChange).toHaveBeenCalledWith(["B"]);
  });
  it("multiSelect=true: cannot deselect the only remaining option", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <PlatformToggle options={["A"]} selected={["A"]} onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[0]);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("multiSelect=false: replaces selection", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <PlatformToggle options={["A", "B"]} selected={["A"]} multiSelect={false} onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[1]);
    expect(onChange).toHaveBeenCalledWith(["B"]);
  });
  it("options as string fallback to value=label=string", () => {
    const { getByText } = render(
      <PlatformToggle options={["Just A String"]} selected={[]} onChange={() => {}} />,
    );
    expect(getByText("Just A String")).toBeInTheDocument();
  });
  it("opt.value missing → falls back to opt.label", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <PlatformToggle options={[{ label: "L1" }]} selected={[]} onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[0]);
    expect(onChange).toHaveBeenCalledWith(["L1"]);
  });
});

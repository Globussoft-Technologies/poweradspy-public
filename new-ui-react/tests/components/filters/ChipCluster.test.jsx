import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  X: () => <i data-testid="x-ic" />,
  ChevronDown: () => <i data-testid="cdown-ic" />,
  ChevronRight: () => <i data-testid="cright-ic" />,
}));

import ChipCluster from "../../../src/components/filters/ChipCluster.jsx";

const PARENT = { value: "p", label: "Apparel" };
const ITEMS = [
  { value: "c1", label: "Shoes" },
  { value: "c2", label: "Hats" },
  { value: "c3", label: "Shirts" },
  { value: "c4", label: "Pants" },
  { value: "c5", label: "Socks" },
];

describe("ChipCluster > collapsed", () => {
  it("childCount=0 → renders parent label only, no chevron, no badge, no click", () => {
    const onExpand = vi.fn();
    const { getByText, queryByTestId, container } = render(
      <ChipCluster parent={PARENT} items={[]} isExpanded={false}
        onExpand={onExpand} onCollapse={() => {}}
        onRemoveParent={() => {}} onRemoveChild={() => {}} />,
    );
    expect(getByText("Apparel")).toBeInTheDocument();
    expect(queryByTestId("cright-ic")).toBeNull();
    // Click parent: no expand (onClick is undefined)
    fireEvent.click(container.querySelector("span"));
    expect(onExpand).not.toHaveBeenCalled();
  });
  it("childCount>0 + collapsed → chevron + +N badge + clickable", () => {
    const onExpand = vi.fn();
    const { getByText, getByTestId, getByTitle } = render(
      <ChipCluster parent={PARENT} items={[{ value: "c", label: "x" }]}
        isExpanded={false}
        onExpand={onExpand} onCollapse={() => {}}
        onRemoveParent={() => {}} onRemoveChild={() => {}} />,
    );
    expect(getByTestId("cright-ic")).toBeInTheDocument();
    expect(getByText("+1")).toBeInTheDocument();
    fireEvent.click(getByTitle("Show subcategories"));
    expect(onExpand).toHaveBeenCalled();
  });
  it("X click → onRemoveParent, stopPropagation prevents expand", () => {
    const onExpand = vi.fn();
    const onRemoveParent = vi.fn();
    const { getByLabelText } = render(
      <ChipCluster parent={PARENT} items={[{ value: "c", label: "x" }]}
        isExpanded={false}
        onExpand={onExpand} onCollapse={() => {}}
        onRemoveParent={onRemoveParent} onRemoveChild={() => {}} />,
    );
    fireEvent.click(getByLabelText("Remove Apparel"));
    expect(onRemoveParent).toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
  });
  it("isExpanded=true but childCount=0 → still renders collapsed (no children to fold)", () => {
    const { queryByTestId } = render(
      <ChipCluster parent={PARENT} items={[]} isExpanded={true}
        onExpand={() => {}} onCollapse={() => {}}
        onRemoveParent={() => {}} onRemoveChild={() => {}} />,
    );
    expect(queryByTestId("cdown-ic")).toBeNull();
  });
});

describe("ChipCluster > expanded", () => {
  it("renders parent + first 3 children + ChevronDown", () => {
    const { getByText, getByTestId, getAllByLabelText } = render(
      <ChipCluster parent={PARENT} items={ITEMS} isExpanded={true}
        onExpand={() => {}} onCollapse={() => {}}
        onRemoveParent={() => {}} onRemoveChild={() => {}} />,
    );
    expect(getByTestId("cdown-ic")).toBeInTheDocument();
    expect(getByText("Apparel")).toBeInTheDocument();
    expect(getByText("Shoes")).toBeInTheDocument();
    expect(getByText("Hats")).toBeInTheDocument();
    expect(getByText("Shirts")).toBeInTheDocument();
    // Removal buttons: parent + 3 children + popover trigger isn't a removal
    expect(getAllByLabelText(/Remove /).length).toBeGreaterThanOrEqual(4);
  });
  it("collapse button → onCollapse", () => {
    const onCollapse = vi.fn();
    const { getByTitle } = render(
      <ChipCluster parent={PARENT} items={ITEMS} isExpanded={true}
        onExpand={() => {}} onCollapse={onCollapse}
        onRemoveParent={() => {}} onRemoveChild={() => {}} />,
    );
    fireEvent.click(getByTitle("Collapse"));
    expect(onCollapse).toHaveBeenCalled();
  });
  it("X parent → onRemoveParent", () => {
    const onRemoveParent = vi.fn();
    const { getByLabelText } = render(
      <ChipCluster parent={PARENT} items={ITEMS} isExpanded={true}
        onExpand={() => {}} onCollapse={() => {}}
        onRemoveParent={onRemoveParent} onRemoveChild={() => {}} />,
    );
    fireEvent.click(getByLabelText("Remove Apparel"));
    expect(onRemoveParent).toHaveBeenCalled();
  });
  it("X child → onRemoveChild with child.value", () => {
    const onRemoveChild = vi.fn();
    const { getByLabelText } = render(
      <ChipCluster parent={PARENT} items={ITEMS} isExpanded={true}
        onExpand={() => {}} onCollapse={() => {}}
        onRemoveParent={() => {}} onRemoveChild={onRemoveChild} />,
    );
    fireEvent.click(getByLabelText("Remove Shoes"));
    expect(onRemoveChild).toHaveBeenCalledWith("c1");
  });
  it("overflow >3 → +N button visible", () => {
    const { getByText } = render(
      <ChipCluster parent={PARENT} items={ITEMS} isExpanded={true}
        onExpand={() => {}} onCollapse={() => {}}
        onRemoveParent={() => {}} onRemoveChild={() => {}} />,
    );
    expect(getByText("+2 more")).toBeInTheDocument();
  });
  it("no overflow → no +N button (only 3 items)", () => {
    const { queryByText } = render(
      <ChipCluster parent={PARENT} items={ITEMS.slice(0, 3)} isExpanded={true}
        onExpand={() => {}} onCollapse={() => {}}
        onRemoveParent={() => {}} onRemoveChild={() => {}} />,
    );
    expect(queryByText(/\+\d+ more/)).toBeNull();
  });
  it("clicking +N opens popover with overflow chips", () => {
    const { getByText, queryByText } = render(
      <ChipCluster parent={PARENT} items={ITEMS} isExpanded={true}
        onExpand={() => {}} onCollapse={() => {}}
        onRemoveParent={() => {}} onRemoveChild={() => {}} />,
    );
    expect(queryByText("Pants")).toBeNull();
    fireEvent.click(getByText("+2 more"));
    expect(getByText("Pants")).toBeInTheDocument();
    expect(getByText("Socks")).toBeInTheDocument();
  });
  it("clicking +N twice toggles popover closed", () => {
    const { getByText, queryByText } = render(
      <ChipCluster parent={PARENT} items={ITEMS} isExpanded={true}
        onExpand={() => {}} onCollapse={() => {}}
        onRemoveParent={() => {}} onRemoveChild={() => {}} />,
    );
    fireEvent.click(getByText("+2 more"));
    fireEvent.click(getByText("+2 more"));
    expect(queryByText("Pants")).toBeNull();
  });
  it("overflow child X → onRemoveChild with that value", () => {
    const onRemoveChild = vi.fn();
    const { getByText, getByLabelText } = render(
      <ChipCluster parent={PARENT} items={ITEMS} isExpanded={true}
        onExpand={() => {}} onCollapse={() => {}}
        onRemoveParent={() => {}} onRemoveChild={onRemoveChild} />,
    );
    fireEvent.click(getByText("+2 more"));
    fireEvent.click(getByLabelText("Remove Socks"));
    expect(onRemoveChild).toHaveBeenCalledWith("c5");
  });
  it("mousedown outside popover closes it", () => {
    const { getByText, queryByText } = render(
      <ChipCluster parent={PARENT} items={ITEMS} isExpanded={true}
        onExpand={() => {}} onCollapse={() => {}}
        onRemoveParent={() => {}} onRemoveChild={() => {}} />,
    );
    fireEvent.click(getByText("+2 more"));
    expect(getByText("Pants")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(queryByText("Pants")).toBeNull();
  });
  it("mousedown inside popover does NOT close it", () => {
    const { getByText } = render(
      <ChipCluster parent={PARENT} items={ITEMS} isExpanded={true}
        onExpand={() => {}} onCollapse={() => {}}
        onRemoveParent={() => {}} onRemoveChild={() => {}} />,
    );
    fireEvent.click(getByText("+2 more"));
    const popoverHeading = getByText(/More in/);
    fireEvent.mouseDown(popoverHeading);
    expect(getByText("Pants")).toBeInTheDocument();
  });
  it("mousedown on anchor does NOT close (handled by anchorRef branch)", () => {
    const { getByText } = render(
      <ChipCluster parent={PARENT} items={ITEMS} isExpanded={true}
        onExpand={() => {}} onCollapse={() => {}}
        onRemoveParent={() => {}} onRemoveChild={() => {}} />,
    );
    const trigger = getByText("+2 more");
    fireEvent.click(trigger);
    fireEvent.mouseDown(trigger);
    expect(getByText("Pants")).toBeInTheDocument();
  });
  it("isExpanded → false transition closes any open popover", () => {
    const { getByText, queryByText, rerender } = render(
      <ChipCluster parent={PARENT} items={ITEMS} isExpanded={true}
        onExpand={() => {}} onCollapse={() => {}}
        onRemoveParent={() => {}} onRemoveChild={() => {}} />,
    );
    fireEvent.click(getByText("+2 more"));
    rerender(
      <ChipCluster parent={PARENT} items={ITEMS} isExpanded={false}
        onExpand={() => {}} onCollapse={() => {}}
        onRemoveParent={() => {}} onRemoveChild={() => {}} />,
    );
    // Now collapsed view, no popover
    expect(queryByText("Pants")).toBeNull();
  });
});

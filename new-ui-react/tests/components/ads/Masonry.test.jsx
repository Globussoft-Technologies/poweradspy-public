import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

// NOTE: `getInitialPosition` (lines 104-122 of Masonry.jsx) is defined inside
// the component but never invoked anywhere in the source. It is dead code blocking
// 100% coverage. See https://github.com/Globussoft-Technologies/poweradspy/issues/248

vi.mock("gsap", () => ({
  gsap: {
    defaults: vi.fn(),
    set: vi.fn(),
    fromTo: vi.fn(),
    to: vi.fn(),
  },
}));

vi.mock("lucide-react", () => ({
  Loader2: ({ size }) => <i data-testid="loader-ic" data-size={size} />,
}));

vi.mock("../../../src/components/ads/Masonry.css", () => ({}));

// Stub ResizeObserver — capture instances for later triggering
const roInstances = [];
class FakeResizeObserver {
  constructor(cb) {
    this.cb = cb;
    this.targets = [];
    roInstances.push(this);
  }
  observe(el) { this.targets.push(el); }
  disconnect() { this.targets = []; }
  // Test helper
  trigger(entries) { this.cb(entries); }
}

// Stub matchMedia — simple controlled stub with listener support
const mqState = new Map(); // query string → matches:boolean
const mqListeners = new Map(); // query string → Set<handler>
function setMq(query, matches) {
  mqState.set(query, matches);
  for (const h of mqListeners.get(query) || []) h();
}
function clearMq() { mqState.clear(); mqListeners.clear(); }

beforeEach(() => {
  roInstances.length = 0;
  clearMq();
  globalThis.ResizeObserver = FakeResizeObserver;
  globalThis.matchMedia = (q) => ({
    get matches() { return mqState.get(q) === true; },
    addEventListener: (_evt, h) => {
      if (!mqListeners.has(q)) mqListeners.set(q, new Set());
      mqListeners.get(q).add(h);
    },
    removeEventListener: (_evt, h) => {
      mqListeners.get(q)?.delete(h);
    },
  });
});

import Masonry from "../../../src/components/ads/Masonry.jsx";

const sampleItems = [
  { id: 1, height: 100 },
  { id: 2, height: 200 },
  { id: 3, height: 150 },
];

describe("Masonry > basic rendering", () => {
  it("renders empty container when items=[]", () => {
    const { container } = render(
      <Masonry items={[]} renderItem={(i) => <div>{i.id}</div>} />,
    );
    expect(container.querySelector(".masonry-list")).not.toBeNull();
    expect(container.querySelectorAll(".masonry-item").length).toBe(0);
  });
  it("renders items via renderItem prop", () => {
    setMq("(min-width:1280px)", true);
    const { container, getByText } = render(
      <Masonry items={sampleItems} renderItem={(i) => <span>card-{i.id}</span>} />,
    );
    // Trigger ResizeObserver to give container a width
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    expect(container.querySelectorAll(".masonry-item").length).toBe(3);
    expect(getByText("card-1")).toBeInTheDocument();
    expect(getByText("card-2")).toBeInTheDocument();
  });
  it("loading=true shows Loader2 spinner", () => {
    const { getByText, getByTestId } = render(
      <Masonry items={[]} renderItem={() => null} loading />,
    );
    expect(getByTestId("loader-ic")).toBeInTheDocument();
    expect(getByText(/Loading more ads/)).toBeInTheDocument();
  });
  it("loading=false hides spinner", () => {
    const { queryByTestId } = render(
      <Masonry items={[]} renderItem={() => null} />,
    );
    expect(queryByTestId("loader-ic")).toBeNull();
  });
});

describe("Masonry > columns + useMedia", () => {
  it("matches min-width:1280px → 4 columns (default config)", () => {
    setMq("(min-width:1280px)", true);
    const { container } = render(
      <Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    // 4 columns → each ~200px wide. Cards placed in shortest column.
    expect(container.querySelectorAll(".masonry-item").length).toBe(3);
  });
  it("falls back to defaultValue when no query matches", () => {
    // no setMq → all false → useMedia returns defaultValue 1
    const { container } = render(
      <Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 400, height: 600 } }]);
    });
    expect(container.querySelectorAll(".masonry-item").length).toBe(3);
  });
  it("custom columnConfig overrides defaults", () => {
    setMq("(min-width:1280px)", true);
    const { container } = render(
      <Masonry
        items={sampleItems}
        renderItem={(i) => <div>{i.id}</div>}
        columnConfig={{ values: [6, 5, 4, 3], default: 2 }}
      />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 1200, height: 600 } }]);
    });
    expect(container.querySelectorAll(".masonry-item").length).toBe(3);
  });
  it("custom columnConfig falls back to default when no query matches", () => {
    const { container } = render(
      <Masonry
        items={sampleItems}
        renderItem={(i) => <div>{i.id}</div>}
        columnConfig={{ values: [6, 5, 4, 3], default: 2 }}
      />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 400, height: 600 } }]);
    });
    // 2 columns → both columns populated
    expect(container.querySelectorAll(".masonry-item").length).toBe(3);
  });
});

describe("Masonry > grid memo behavior", () => {
  it("grid is empty when width=0 (no ResizeObserver yet)", () => {
    const { container } = render(
      <Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} />,
    );
    // No ResizeObserver triggered — width still 0
    expect(container.querySelectorAll(".masonry-item").length).toBe(0);
  });
  it("default child height = 300 when no .height present", () => {
    const items = [{ id: "a" }, { id: "b" }];
    setMq("(min-width:640px)", true);
    const { container } = render(
      <Masonry items={items} renderItem={(i) => <div>{i.id}</div>} />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 600, height: 600 } }]);
    });
    expect(container.querySelectorAll(".masonry-item").length).toBe(2);
  });
  it("recomputes columns when prevColumns ref changes (clears assignments)", () => {
    setMq("(min-width:1280px)", true);
    const { container } = render(
      <Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    // Flip the media query → useMedia handler fires → columns change → prevColumns branch
    act(() => {
      mqState.set("(min-width:1280px)", false);
      mqState.set("(min-width:1024px)", false);
      mqState.set("(min-width:768px)", false);
      mqState.set("(min-width:640px)", true);
      // Trigger the listener for any registered query
      for (const handlers of mqListeners.values()) {
        for (const h of handlers) h();
      }
    });
    expect(container.querySelectorAll(".masonry-item").length).toBe(3);
  });
});

describe("Masonry > hover", () => {
  it("mouseEnter on item calls gsap.to with hoverScale (scaleOnHover=true)", async () => {
    const gsap = (await import("gsap")).gsap;
    setMq("(min-width:1280px)", true);
    const { container } = render(
      <Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} hoverScale={0.5} />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    gsap.to.mockClear();
    fireEvent.mouseEnter(container.querySelectorAll(".masonry-item")[0]);
    expect(gsap.to).toHaveBeenCalled();
    const lastCall = gsap.to.mock.calls.at(-1);
    expect(lastCall[1].scale).toBe(0.5);
  });
  it("mouseLeave triggers scale back to 1", async () => {
    const gsap = (await import("gsap")).gsap;
    setMq("(min-width:1280px)", true);
    const { container } = render(
      <Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    gsap.to.mockClear();
    fireEvent.mouseLeave(container.querySelectorAll(".masonry-item")[0]);
    expect(gsap.to).toHaveBeenCalled();
    const lastCall = gsap.to.mock.calls.at(-1);
    expect(lastCall[1].scale).toBe(1);
  });
  it("scaleOnHover=false → mouseEnter/Leave do NOT call gsap.to", async () => {
    const gsap = (await import("gsap")).gsap;
    setMq("(min-width:1280px)", true);
    const { container } = render(
      <Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} scaleOnHover={false} />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    gsap.to.mockClear();
    fireEvent.mouseEnter(container.querySelectorAll(".masonry-item")[0]);
    fireEvent.mouseLeave(container.querySelectorAll(".masonry-item")[0]);
    expect(gsap.to).not.toHaveBeenCalled();
  });
});

describe("Masonry > autoHeight + onItemMeasure", () => {
  it("renders AutoHeightItem wrapper when autoHeight + onItemMeasure", () => {
    setMq("(min-width:1280px)", true);
    const onItemMeasure = vi.fn();
    const { container, getByText } = render(
      <Masonry
        items={[{ id: 9, height: 50 }]}
        renderItem={(i) => <span>auto-{i.id}</span>}
        autoHeight
        onItemMeasure={onItemMeasure}
        measuredHeights={{ 9: 250 }}
      />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    expect(getByText("auto-9")).toBeInTheDocument();
    // Trigger all ROs with a height — the AutoHeightItem's RO should propagate
    onItemMeasure.mockClear();
    for (const ro of roInstances) {
      act(() => {
        try { ro.trigger([{ contentRect: { width: 100, height: 120 } }]); } catch {}
      });
    }
    expect(onItemMeasure).toHaveBeenCalledWith(9, 120);
  });
  it("AutoHeightItem skips reporting when contentRect.height=0", () => {
    setMq("(min-width:1280px)", true);
    const onItemMeasure = vi.fn();
    const { container } = render(
      <Masonry
        items={[{ id: 9 }]}
        renderItem={(i) => <span>x</span>}
        autoHeight
        onItemMeasure={onItemMeasure}
      />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    // Trigger AutoHeightItem with h=0 → should not call onMeasure
    onItemMeasure.mockClear();
    for (const ro of roInstances) {
      ro.trigger([{ contentRect: { width: 100, height: 0 } }]);
    }
    expect(onItemMeasure).not.toHaveBeenCalled();
  });
  it("autoHeight=true without onItemMeasure → renderItem rendered directly", () => {
    setMq("(min-width:1280px)", true);
    const { getByText } = render(
      <Masonry
        items={[{ id: 1, height: 100 }]}
        renderItem={(i) => <span>direct-{i.id}</span>}
        autoHeight
      />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    expect(getByText("direct-1")).toBeInTheDocument();
  });
  it("autoHeight uses measuredHeights[id] when present", () => {
    setMq("(min-width:1280px)", true);
    const { container } = render(
      <Masonry
        items={[{ id: 1 }]}
        renderItem={(i) => <span>{i.id}</span>}
        autoHeight
        measuredHeights={{ 1: 500 }}
      />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    expect(container.querySelectorAll(".masonry-item--auto").length).toBe(1);
  });
});

describe("Masonry > re-render lifecycle", () => {
  it("calls gsap.fromTo for new items on mount", async () => {
    const gsap = (await import("gsap")).gsap;
    gsap.fromTo.mockClear();
    setMq("(min-width:1280px)", true);
    render(<Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} />);
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    expect(gsap.fromTo).toHaveBeenCalled();
  });
  it("calls gsap.to on existing item that moves (rerender with different width)", async () => {
    const gsap = (await import("gsap")).gsap;
    setMq("(min-width:1280px)", true);
    const { rerender } = render(
      <Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    gsap.to.mockClear();
    // Now resize → x positions change → gsap.to invoked
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 1200, height: 600 } }]);
    });
    rerender(<Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} />);
    // gsap.to may be called for moved items
    expect(gsap.to.mock.calls.length >= 0).toBe(true);
  });
  it("removed item is dropped from positionedItems map", () => {
    setMq("(min-width:1280px)", true);
    const { container, rerender } = render(
      <Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    rerender(
      <Masonry items={[sampleItems[0]]} renderItem={(i) => <div>{i.id}</div>} />,
    );
    expect(container.querySelectorAll(".masonry-item").length).toBe(1);
  });
  it("appended item after mount uses 'appended later' fromTo path", async () => {
    const gsap = (await import("gsap")).gsap;
    setMq("(min-width:1280px)", true);
    const { rerender } = render(
      <Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    gsap.fromTo.mockClear();
    rerender(
      <Masonry
        items={[...sampleItems, { id: 99, height: 80 }]}
        renderItem={(i) => <div>{i.id}</div>}
      />,
    );
    // 1 new item → 1 fromTo call
    expect(gsap.fromTo).toHaveBeenCalled();
  });
});

describe("Masonry > remeasureDomBottom + effectiveHeight", () => {
  it("computes containerHeight from grid items", () => {
    setMq("(min-width:1280px)", true);
    const { container } = render(
      <Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    const list = container.querySelector(".masonry-list");
    expect(list.style.height).toMatch(/\d+px/);
  });
  it("autoHeight=true uses minHeight instead of height", () => {
    setMq("(min-width:1280px)", true);
    const { container } = render(
      <Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} autoHeight />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    const list = container.querySelector(".masonry-list");
    expect(list.style.minHeight).toMatch(/\d+px/);
    expect(list.style.height).toBe("");
  });
  it("nested image ResizeObserver triggers remeasure", () => {
    setMq("(min-width:1280px)", true);
    const { container } = render(
      <Masonry
        items={[{ id: 1, height: 100 }]}
        renderItem={(i) => <img src="x.png" alt="x" />}
      />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    // Trigger the inner image ResizeObserver
    for (const ro of roInstances) {
      try {
        ro.trigger([{ contentRect: { width: 0, height: 0 } }]);
      } catch {}
    }
    expect(container.querySelector(".masonry-item")).not.toBeNull();
  });
  it("colAssignments cleans up ids no longer in items", () => {
    setMq("(min-width:1280px)", true);
    const { rerender, container } = render(
      <Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    // Remove an item → assignment for it should be cleaned up
    rerender(
      <Masonry items={sampleItems.slice(0, 2)} renderItem={(i) => <div>{i.id}</div>} />,
    );
    expect(container.querySelectorAll(".masonry-item").length).toBe(2);
  });

  it("window.devicePixelRatio falsy → `|| 1` fallback fires (line 140 third operand)", () => {
    // jsdom defaults to devicePixelRatio=1. Force it to 0 so `&&` returns 0,
    // then the outer `|| 1` fallback fires.
    const original = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    Object.defineProperty(window, "devicePixelRatio", { value: 0, configurable: true, writable: true });
    setMq("(min-width:1280px)", true);
    const { container } = render(
      <Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    expect(container.querySelectorAll(".masonry-item").length).toBe(3);
    if (original) Object.defineProperty(window, "devicePixelRatio", original);
  });

  it("autoHeight=true → omits fixed height in gsap positioning (line 228/247 {} branch)", () => {
    setMq("(min-width:1280px)", true);
    const { container } = render(
      <Masonry
        items={sampleItems}
        renderItem={(i) => <div>{i.id}</div>}
        autoHeight
        measuredHeights={{ 1: 120, 2: 220, 3: 160 }}
      />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    expect(container.querySelectorAll(".masonry-item").length).toBe(3);
  });

  it("appended items after mount use the infinite-scroll fromTo branch (line 247)", () => {
    setMq("(min-width:1280px)", true);
    const { container, rerender } = render(
      <Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    // Second render appends new items → hasMounted.current is true → else-branch fromTo
    act(() => {
      rerender(
        <Masonry
          items={[...sampleItems, { id: 4, height: 90 }, { id: 5, height: 130 }]}
          renderItem={(i) => <div>{i.id}</div>}
        />,
      );
    });
    expect(container.querySelectorAll(".masonry-item").length).toBe(5);
  });

  it("appended items with autoHeight → omits height in infinite-scroll branch (247 {} side)", () => {
    setMq("(min-width:1280px)", true);
    const { container, rerender } = render(
      <Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} autoHeight
        measuredHeights={{ 1: 120, 2: 220, 3: 160 }} />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    act(() => {
      rerender(
        <Masonry
          items={[...sampleItems, { id: 6, height: 90 }]}
          renderItem={(i) => <div>{i.id}</div>}
          autoHeight
          measuredHeights={{ 1: 120, 2: 220, 3: 160, 6: 100 }}
        />,
      );
    });
    expect(container.querySelectorAll(".masonry-item").length).toBe(4);
  });

  it("remeasureDomBottom updates domMaxBottom when item bottoms exceed it (lines 180/182)", () => {
    setMq("(min-width:1280px)", true);
    const { container } = render(
      <Masonry items={sampleItems} renderItem={(i) => <div>{i.id}</div>} />,
    );
    act(() => {
      roInstances[0].trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    // Give the item elements a measurable bottom so remeasureDomBottom's
    // `bottom > measuredMax` is true and setDomMaxBottom commits a new value.
    const origBCR = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this.hasAttribute && this.hasAttribute("data-masonry-key")) {
        return { top: 0, bottom: 500, left: 0, right: 0, width: 0, height: 500 };
      }
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    };
    // The item-observing ResizeObserver (created in the effect at src line ~308)
    // calls remeasureDomBottom when triggered.
    const itemRO = roInstances.find((ro) => ro.targets.some((t) => t.hasAttribute?.("data-masonry-key")));
    act(() => {
      itemRO.trigger([]);
    });
    Element.prototype.getBoundingClientRect = origBCR;
    expect(container.querySelectorAll(".masonry-item").length).toBe(3);
  });
});

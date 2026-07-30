import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDocumentFilterKeys } from "../../../src/components/sdui/AiSignalsModal";
import AiSignalsModal from "../../../src/components/sdui/AiSignalsModal";
import { ThemeProvider } from "../../../src/hooks/useTheme";

describe("AiSignalsModal draft keys", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("includes both state keys owned by a nested category filter", () => {
    const keys = getDocumentFilterKeys({
      filters: [
        { _id: "ai_colors" },
        {
          _id: "ai_category_id",
          parent_filter_id: "ai_category_id",
          child_filter_id: "ai_subcategory_id",
        },
      ],
    });

    expect(keys).toEqual([
      "ai_colors",
      "ai_category_id",
      "ai_subcategory_id",
    ]);
  });

  it("shows quick-filter values as selected when the popup opens", () => {
    render(
      <ThemeProvider>
        <AiSignalsModal
          isOpen
          document={{
            _id: "ai_meta",
            visible: true,
            filters: [
              {
                _id: "ai_ad_type",
                label: "Ad Type",
                type: "chip_multi_select",
                visible: true,
                show_label: true,
                options: [
                  { label: "Ugc", value: "ugc" },
                  { label: "Testimonial", value: "testimonial" },
                ],
              },
            ],
          }}
          filterValues={{ ai_ad_type: ["ugc"] }}
          onClose={vi.fn()}
          onApply={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByRole("button", { name: "Ugc" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("1 selected across 1 group")).toBeInTheDocument();
    expect(screen.getByText("1 selection ready to apply")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Ad Type: Ugc" }),
    ).toBeInTheDocument();
  });

  it("navigates between groups and applies the focused draft", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <ThemeProvider>
        <AiSignalsModal
          isOpen
          document={{
            _id: "ai_meta",
            visible: true,
            filters: [
              {
                _id: "ai_ad_type",
                label: "Ad Type",
                type: "chip_multi_select",
                visible: true,
                options: [{ label: "Ugc", value: "ugc" }],
              },
              {
                _id: "ai_intent",
                label: "Intent",
                type: "chip_multi_select",
                visible: true,
                options: [
                  { label: "Awareness", value: "awareness" },
                  { label: "Conversion", value: "conversion" },
                ],
              },
            ],
          }}
          filterValues={{}}
          onClose={onClose}
          onApply={onApply}
        />
      </ThemeProvider>,
    );

    expect(screen.getByRole("button", { name: "Ugc" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Intent" }));
    expect(
      screen.getByRole("button", { name: "Awareness" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ugc" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Awareness" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply 1" }));

    expect(onApply).toHaveBeenCalledWith({ ai_intent: ["awareness"] });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clears applied AI values as a draft before Apply", () => {
    const onApply = vi.fn();
    render(
      <ThemeProvider>
        <AiSignalsModal
          isOpen
          document={{
            _id: "ai_meta",
            visible: true,
            filters: [
              {
                _id: "ai_ad_type",
                label: "Ad Type",
                type: "chip_multi_select",
                visible: true,
                options: [{ label: "Ugc", value: "ugc" }],
              },
            ],
          }}
          filterValues={{ ai_ad_type: ["ugc"] }}
          onClose={vi.fn()}
          onApply={onApply}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith({});
  });

  it("does not close when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <AiSignalsModal
          isOpen
          document={{
            _id: "ai_meta",
            visible: true,
            filters: [],
          }}
          filterValues={{}}
          onClose={onClose}
          onApply={vi.fn()}
        />
      </ThemeProvider>,
    );

    fireEvent.click(container.firstElementChild);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("uses external filter changes when reopened without an active draft", () => {
    const document = {
      _id: "ai_meta",
      visible: true,
      filters: [
        {
          _id: "ai_ad_type",
          label: "Ad Type",
          type: "chip_multi_select",
          visible: true,
          options: [
            { label: "Ugc", value: "ugc" },
            { label: "Testimonial", value: "testimonial" },
          ],
        },
      ],
    };
    const { rerender } = render(
      <ThemeProvider>
        <AiSignalsModal
          isOpen={false}
          document={document}
          filterValues={{ ai_ad_type: ["ugc"] }}
          onClose={vi.fn()}
          onApply={vi.fn()}
        />
      </ThemeProvider>,
    );

    rerender(
      <ThemeProvider>
        <AiSignalsModal
          isOpen={false}
          document={document}
          filterValues={{ ai_ad_type: ["testimonial"] }}
          onClose={vi.fn()}
          onApply={vi.fn()}
        />
      </ThemeProvider>,
    );
    rerender(
      <ThemeProvider>
        <AiSignalsModal
          isOpen
          document={document}
          filterValues={{ ai_ad_type: ["testimonial"] }}
          onClose={vi.fn()}
          onApply={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByRole("button", { name: "Ugc" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getByRole("button", { name: "Testimonial" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("translates a curated color palette into backend hex values", () => {
    const onApply = vi.fn();
    render(
      <ThemeProvider>
        <AiSignalsModal
          isOpen
          document={{
            _id: "ai_meta",
            visible: true,
            filters: [
              {
                _id: "ai_colors",
                label: "Colors",
                type: "chip_multi_select",
                visible: true,
                options: [
                  { label: "#E03131", value: "#E03131" },
                  { label: "#F76707", value: "#F76707" },
                  { label: "#F2CC0C", value: "#F2CC0C" },
                  { label: "#E64980", value: "#E64980" },
                  { label: "#C9A227", value: "#C9A227" },
                ],
              },
            ],
          }}
          filterValues={{}}
          onClose={vi.fn()}
          onApply={onApply}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Warm Glow" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply 5" }));
    expect(onApply).toHaveBeenCalledWith({
      ai_colors: [
        "#E03131",
        "#F76707",
        "#F2CC0C",
        "#E64980",
        "#C9A227",
      ],
    });
  });
});

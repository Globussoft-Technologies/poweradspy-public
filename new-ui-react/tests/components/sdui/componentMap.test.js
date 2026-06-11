import { describe, it, expect, vi } from "vitest";

// Stub every filter import so this test doesn't pull in the whole component tree.
vi.mock("../../../src/components/filters/FilterCheckboxList", () => ({ default: "FilterCheckboxList" }));
vi.mock("../../../src/components/filters/FilterRadioList", () => ({ default: "FilterRadioList" }));
vi.mock("../../../src/components/filters/SliderFilter", () => ({ default: "SliderFilter" }));
vi.mock("../../../src/components/filters/DateRangeFilter", () => ({ default: "DateRangeFilter" }));
vi.mock("../../../src/components/filters/NestedMultiselectFilter", () => ({ default: "NestedMultiselectFilter" }));
vi.mock("../../../src/components/filters/ChipMultiSelect", () => ({ default: "ChipMultiSelect" }));
vi.mock("../../../src/components/filters/ToggleSwitchFilter", () => ({ default: "ToggleSwitchFilter" }));
vi.mock("../../../src/components/filters/ComboboxFilter", () => ({ default: "ComboboxFilter" }));
vi.mock("../../../src/components/filters/DatePresetFilter", () => ({ default: "DatePresetFilter" }));
vi.mock("../../../src/components/filters/SegmentedControl", () => ({ default: "SegmentedControl" }));
vi.mock("../../../src/components/filters/PlatformToggle", () => ({ default: "PlatformToggle" }));
vi.mock("../../../src/components/filters/AutocompleteFilter", () => ({ default: "AutocompleteFilter" }));

import COMPONENT_MAP from "../../../src/components/sdui/componentMap.js";

describe("componentMap > registry", () => {
  it("autocomplete → AutocompleteFilter", () => {
    expect(COMPONENT_MAP.autocomplete).toBe("AutocompleteFilter");
  });
  it("radio → FilterRadioList", () => {
    expect(COMPONENT_MAP.radio).toBe("FilterRadioList");
  });
  it("checkbox + multiselect both → FilterCheckboxList", () => {
    expect(COMPONENT_MAP.checkbox).toBe("FilterCheckboxList");
    expect(COMPONENT_MAP.multiselect).toBe("FilterCheckboxList");
  });
  it("nested_select + nested_multiselect both → NestedMultiselectFilter", () => {
    expect(COMPONENT_MAP.nested_select).toBe("NestedMultiselectFilter");
    expect(COMPONENT_MAP.nested_multiselect).toBe("NestedMultiselectFilter");
  });
  it("chip_multi_select → ChipMultiSelect", () => {
    expect(COMPONENT_MAP.chip_multi_select).toBe("ChipMultiSelect");
  });
  it("combobox → ComboboxFilter", () => {
    expect(COMPONENT_MAP.combobox).toBe("ComboboxFilter");
  });
  it("range_slider → SliderFilter", () => {
    expect(COMPONENT_MAP.range_slider).toBe("SliderFilter");
  });
  it("date_range + date_range_custom both → DateRangeFilter", () => {
    expect(COMPONENT_MAP.date_range).toBe("DateRangeFilter");
    expect(COMPONENT_MAP.date_range_custom).toBe("DateRangeFilter");
  });
  it("date_preset → DatePresetFilter", () => {
    expect(COMPONENT_MAP.date_preset).toBe("DatePresetFilter");
  });
  it("icon_toggle → PlatformToggle", () => {
    expect(COMPONENT_MAP.icon_toggle).toBe("PlatformToggle");
  });
  it("toggle_switch → ToggleSwitchFilter", () => {
    expect(COMPONENT_MAP.toggle_switch).toBe("ToggleSwitchFilter");
  });
  it("segmented_control → SegmentedControl", () => {
    expect(COMPONENT_MAP.segmented_control).toBe("SegmentedControl");
  });
  it("unknown type → undefined (no fallback)", () => {
    expect(COMPONENT_MAP.unknown_type).toBeUndefined();
  });
});

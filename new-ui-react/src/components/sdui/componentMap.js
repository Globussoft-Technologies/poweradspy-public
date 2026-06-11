/**
 * componentMap.js — Central registry mapping SDUI filter.type → React component.
 *
 * To add a new filter type:
 * 1. Create the component in src/components/filters/
 * 2. Import it here
 * 3. Add the mapping below
 */

import FilterCheckboxList from '../filters/FilterCheckboxList';
import FilterRadioList from '../filters/FilterRadioList';
import SliderFilter from '../filters/SliderFilter';
import DateRangeFilter from '../filters/DateRangeFilter';
import NestedMultiselectFilter from '../filters/NestedMultiselectFilter';
import ChipMultiSelect from '../filters/ChipMultiSelect';
import ToggleSwitchFilter from '../filters/ToggleSwitchFilter';
import ComboboxFilter from '../filters/ComboboxFilter';
import DatePresetFilter from '../filters/DatePresetFilter';
import SegmentedControl from '../filters/SegmentedControl';
import PlatformToggle from '../filters/PlatformToggle';
import AutocompleteFilter from '../filters/AutocompleteFilter';

const COMPONENT_MAP = {
    // Text / search
    autocomplete:        AutocompleteFilter,

    // Selection
    radio:               FilterRadioList,
    checkbox:            FilterCheckboxList,
    multiselect:         FilterCheckboxList,
    nested_select:       NestedMultiselectFilter,
    nested_multiselect:  NestedMultiselectFilter,
    chip_multi_select:   ChipMultiSelect,
    combobox:            ComboboxFilter,

    // Ranges / sliders
    range_slider:        SliderFilter,

    // Dates
    date_range:          DateRangeFilter,
    date_preset:         DatePresetFilter,
    date_range_custom:   DateRangeFilter, // DateRangeFilter already supports custom

    // Toggles / controls
    icon_toggle:         PlatformToggle,
    toggle_switch:       ToggleSwitchFilter,
    segmented_control:   SegmentedControl,
};

export default COMPONENT_MAP;

// Human-readable names for the fixed AI-Meta color vocabulary. SDUI labels
// still take precedence, so the UI can evolve without changing query values.
export const AI_COLOR_NAMES = Object.freeze({
  "#000000": "Black",
  "#FFFFFF": "White",
  "#808080": "Gray",
  "#C0C0C0": "Silver",
  "#E03131": "Red",
  "#F76707": "Orange",
  "#F2CC0C": "Yellow",
  "#2F9E44": "Green",
  "#0CA678": "Teal",
  "#1971C2": "Blue",
  "#1E3A5F": "Navy",
  "#7048E8": "Purple",
  "#E64980": "Pink",
  "#8B5E34": "Brown",
  "#C9A227": "Gold",
  "#E8D8B0": "Beige",
});

// Curated shortcuts use only values from the fixed backend palette. Groups may
// overlap intentionally where a color naturally belongs to multiple palettes.
export const AI_COLOR_GROUPS = Object.freeze([
  {
    id: "warm_glow",
    label: "Warm Glow",
    values: ["#E03131", "#F76707", "#F2CC0C", "#E64980", "#C9A227"],
  },
  {
    id: "cool_contrast",
    label: "Cool Contrast",
    values: ["#2F9E44", "#0CA678", "#1971C2", "#1E3A5F", "#7048E8"],
  },
  {
    id: "monochrome",
    label: "Monochrome",
    values: ["#000000", "#FFFFFF", "#808080", "#C0C0C0"],
  },
  {
    id: "earth_tones",
    label: "Earth Tones",
    values: ["#8B5E34", "#E8D8B0", "#C9A227", "#2F9E44"],
  },
]);

const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/i;

export const normalizeAiColorHex = (value) => {
  const candidate = String(value ?? "").trim();
  return HEX_COLOR_PATTERN.test(candidate) ? candidate.toUpperCase() : candidate;
};

export const getAiColorLabel = (value, configuredLabel) => {
  const normalizedValue = normalizeAiColorHex(value);
  const label = String(configuredLabel ?? "").trim();

  // A descriptive SDUI label is authoritative. Existing documents that use
  // the raw hex as their label get a safe fallback from the fixed palette.
  if (label && !HEX_COLOR_PATTERN.test(label)) return label;
  return AI_COLOR_NAMES[normalizedValue] || label || normalizedValue;
};

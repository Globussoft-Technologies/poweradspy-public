const MODEL_PRICING = {
  "gpt-image-1.5": {
    provider: "openai",
    input_per_million: 8,
    output_per_million: 32
  },

  "gemini-3-pro-image-preview": {
    provider: "google",
    input_per_million: 2,
    output_per_million: 120
  },

  "imagen-4.0-generate-001": {
    provider: "google",
    per_image: 0.04
  }
};

module.exports = { MODEL_PRICING };

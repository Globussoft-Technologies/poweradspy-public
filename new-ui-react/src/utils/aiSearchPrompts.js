// Keep the planner's stable English input separate from the localized text
// shown in the search field after a user selects a built-in prompt.
export const AI_SEARCH_PROMPT_DEFINITIONS = [
  {
    id: "mobile-app-installs",
    prompt: "Find ads promoting mobile app installs.",
    translationKey: "ai_search_prompt_mobile_app_installs",
  },
  {
    id: "weight-loss-products",
    prompt: "Show me ads for weight-loss products.",
    translationKey: "ai_search_prompt_weight_loss_products",
  },
  {
    id: "beauty-trends",
    prompt: "What ads are trending in the beauty industry?",
    translationKey: "ai_search_prompt_beauty_trends",
  },
  {
    id: "recent-india-ads",
    prompt: "Find recently launched ads in India.",
    translationKey: "ai_search_prompt_recent_india_ads",
  },
  {
    id: "high-engagement-video-ads",
    prompt: "Show me high-engagement video ads.",
    translationKey: "ai_search_prompt_high_engagement_video_ads",
  },
];

// Preserve the original English-only export for callers that only need the
// canonical planner prompts.
export const AI_SEARCH_PROMPTS = AI_SEARCH_PROMPT_DEFINITIONS.map(({ prompt }) => prompt);

export const getLocalizedAiSearchPrompt = (definition, translate) => {
  if (!definition) return "";
  if (typeof translate !== "function") return definition.prompt;

  const translated = translate(definition.translationKey, definition.prompt);
  return typeof translated === "string" && translated.trim()
    ? translated
    : definition.prompt;
};

export const getAiSearchPromptSelection = (definition, translate) => ({
  prompt: definition?.prompt || "",
  displayPrompt: getLocalizedAiSearchPrompt(definition, translate),
});

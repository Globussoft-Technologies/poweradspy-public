import {
  AI_SEARCH_PROMPTS,
  AI_SEARCH_PROMPT_DEFINITIONS,
  getAiSearchPromptSelection,
  getLocalizedAiSearchPrompt,
} from "../../src/utils/aiSearchPrompts";

describe("AI search prompt templates", () => {
  it("keeps the canonical planner prompts compatible with the original export", () => {
    expect(AI_SEARCH_PROMPTS).toEqual(
      AI_SEARCH_PROMPT_DEFINITIONS.map(({ prompt }) => prompt),
    );
  });

  it("keeps localized display text separate from the canonical planner prompt", () => {
    const definition = AI_SEARCH_PROMPT_DEFINITIONS[1];
    const translate = vi.fn((key, fallback) => (
      key === definition.translationKey ? "اعرض لي إعلانات لمنتجات إنقاص الوزن." : fallback
    ));

    expect(getAiSearchPromptSelection(definition, translate)).toEqual({
      prompt: "Show me ads for weight-loss products.",
      displayPrompt: "اعرض لي إعلانات لمنتجات إنقاص الوزن.",
    });
  });

  it("falls back to the canonical prompt when translation is unavailable", () => {
    const definition = AI_SEARCH_PROMPT_DEFINITIONS[0];
    expect(getLocalizedAiSearchPrompt(definition, () => "")).toBe(definition.prompt);
  });
});

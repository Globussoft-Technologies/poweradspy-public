import { describe, expect, it } from "vitest";
import { getDocumentFilterKeys } from "../../../src/components/sdui/AiSignalsModal";

describe("AiSignalsModal draft keys", () => {
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
});


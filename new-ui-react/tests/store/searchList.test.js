import { describe, expect, it } from "vitest";
import reducer, { setSearchList } from "../../src/store/uiSlice.js";

describe("store/uiSlice > searchList", () => {
  it("starts with no AI Search list", () => {
    expect(reducer(undefined, { type: "@@INIT" }).searchList).toBeNull();
  });

  it("stores and clears a keyword or advertiser list", () => {
    const list = { searchIn: "keyword", query: "flipkart, amazon", terms: ["flipkart", "amazon"] };

    const withList = reducer(undefined, setSearchList(list));

    expect(withList.searchList).toEqual(list);
    expect(reducer(withList, setSearchList(null)).searchList).toBeNull();
  });
});

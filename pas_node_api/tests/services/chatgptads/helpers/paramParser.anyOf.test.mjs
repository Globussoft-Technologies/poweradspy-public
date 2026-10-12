import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { parseSearchParams } = require("../../../../src/services/chatgptads/helpers/paramParser");

describe("chatgptads paramParser > keyword and advertiser values", () => {
  it("keeps a plain string trimmed, as before", () => {
    const p = parseSearchParams({ keyword: " flipkart ", advertiser: "Nike" });
    expect(p.keyword).toBe("flipkart");
    expect(p.advertiser).toBe("Nike");
  });

  it("keeps an AI Search list as trimmed, non-blank terms", () => {
    const p = parseSearchParams({ keyword: ["flipkart", " amazon ", ""], advertiser: ["Nike", "Adidas"] });
    expect(p.keyword).toEqual(["flipkart", "amazon"]);
    expect(p.advertiser).toEqual(["Nike", "Adidas"]);
  });

  it("a list of blanks becomes an empty search value", () => {
    expect(parseSearchParams({ keyword: ["", " "] }).keyword).toBe("");
  });

  it("the parser treats the NA placeholder and missing values as empty", () => {
    expect(parseSearchParams({ keyword: "NA" }).keyword).toBe("");
    expect(parseSearchParams({}).keyword).toBe("");
  });
});

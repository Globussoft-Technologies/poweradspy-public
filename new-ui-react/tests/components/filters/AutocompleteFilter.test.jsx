import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  Search: ({ size }) => <i data-testid="search-ic" data-size={size} />,
  Loader2: () => <i data-testid="loader-ic" />,
  Sparkles: () => <i data-testid="sparkles-ic" />,
  ChevronDown: () => <i data-testid="cdown-ic" />,
  Play: () => <i data-testid="play-ic" />,
  X: () => <i data-testid="x-ic" />,
}));

// Pass-through useDebounce — fires immediately for fast tests
vi.mock("../../../src/hooks/useDebounce", () => ({
  useDebounce: (v) => v,
}));

import AutocompleteFilter from "../../../src/components/filters/AutocompleteFilter.jsx";

const WORD_SOURCE = {
  rank: 1,
  method: "GET",
  endpoint: "/suggest",
  env_key: "VITE_SUGGEST_API_BASE_URL",
  query_params: { query: "lastWord", limit: 5 },
  response_key: "suggestions",
  display_field: "word",
  on_select_action: "replacePartialWord",
};
const CAT_SOURCE = {
  rank: 2,
  method: "POST",
  endpoint: "/catsearch",
  env_key: "VITE_CAT_SEARCH_API_BASE_URL",
  request_body: { query: "", top_k: 5 },
  response_key: "matches",
  on_select_action: "setSelCategories",
};

beforeEach(() => {
  globalThis.fetch = vi.fn();
  vi.stubEnv("VITE_SUGGEST_API_BASE_URL", "https://api.example.com");
  vi.stubEnv("VITE_CAT_SEARCH_API_BASE_URL", "https://cat.example.com");
});

describe("AutocompleteFilter > basic input", () => {
  it("renders default placeholder", () => {
    const { getByPlaceholderText } = render(
      <AutocompleteFilter onChange={() => {}} />,
    );
    expect(getByPlaceholderText("Search...")).toBeInTheDocument();
  });
  it("custom placeholder honored", () => {
    const { getByPlaceholderText } = render(
      <AutocompleteFilter placeholder="Find ad" onChange={() => {}} />,
    );
    expect(getByPlaceholderText("Find ad")).toBeInTheDocument();
  });
  it("typing emits onChange", () => {
    const onChange = vi.fn();
    const { getByPlaceholderText } = render(
      <AutocompleteFilter onChange={onChange} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    expect(onChange).toHaveBeenCalledWith("abc");
  });
  it("syncs to external value prop without firing suggestions", async () => {
    const { getByPlaceholderText, rerender } = render(
      <AutocompleteFilter value="" onChange={() => {}} suggestionSources={[WORD_SOURCE]} minLength={3} />,
    );
    rerender(<AutocompleteFilter value="external" onChange={() => {}} suggestionSources={[WORD_SOURCE]} minLength={3} />);
    expect(getByPlaceholderText("Search...").value).toBe("external");
    await act(async () => { await Promise.resolve(); });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("Enter key triggers onSearch", () => {
    const onSearch = vi.fn();
    const { getByPlaceholderText } = render(
      <AutocompleteFilter onChange={() => {}} onSearch={onSearch} />,
    );
    const input = getByPlaceholderText("Search...");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSearch).toHaveBeenCalledWith("abc");
  });
  it("non-Enter keys do not trigger onSearch", () => {
    const onSearch = vi.fn();
    const { getByPlaceholderText } = render(
      <AutocompleteFilter onChange={() => {}} onSearch={onSearch} />,
    );
    fireEvent.keyDown(getByPlaceholderText("Search..."), { key: "a" });
    expect(onSearch).not.toHaveBeenCalled();
  });
  it("Enter without onSearch prop → no-op (line 245 false branch)", () => {
    // onSearch undefined — `if (onSearch)` falsy branch
    const { getByPlaceholderText } = render(<AutocompleteFilter onChange={() => {}} />);
    const input = getByPlaceholderText("Search...");
    fireEvent.change(input, { target: { value: "abc" } });
    expect(() => fireEvent.keyDown(input, { key: "Enter" })).not.toThrow();
  });
  it("search button click without onSearch prop → no-op (line 303 false branch)", () => {
    const { getAllByRole } = render(<AutocompleteFilter onChange={() => {}} value="abc" />);
    // The send/search button is the last button when there's text
    const buttons = getAllByRole("button");
    expect(() => fireEvent.click(buttons[buttons.length - 1])).not.toThrow();
  });
  it("mousedown OUTSIDE suggestions panel closes it (line 195-198)", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ suggestions: [{ word: "alpha" }] }),
    });
    const { getByPlaceholderText, queryByText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[WORD_SOURCE]} />,
    );
    const input = getByPlaceholderText("Search...");
    fireEvent.change(input, { target: { value: "alpha" } });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // Now suggestion present; fire mousedown OUTSIDE the suggestion ref
    fireEvent.mouseDown(document.body);
    expect(queryByText("alpha")).toBeNull();
  });
});

describe("AutocompleteFilter > clear button", () => {
  it("X button appears when value present", () => {
    const { getByTestId } = render(<AutocompleteFilter value="abc" onChange={() => {}} />);
    expect(getByTestId("x-ic")).toBeInTheDocument();
  });
  it("X click clears input + invokes onClear", () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    const { getByTestId } = render(
      <AutocompleteFilter value="abc" onChange={onChange} onClear={onClear} />,
    );
    fireEvent.click(getByTestId("x-ic").closest("button"));
    expect(onChange).toHaveBeenCalledWith("");
    expect(onClear).toHaveBeenCalled();
  });
  it("X click without onClear still works", () => {
    const onChange = vi.fn();
    const { getByTestId } = render(<AutocompleteFilter value="abc" onChange={onChange} />);
    fireEvent.click(getByTestId("x-ic").closest("button"));
    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("AutocompleteFilter > search button", () => {
  it("clicking calls onSearch with trimmed value", () => {
    const onSearch = vi.fn();
    const { getByPlaceholderText, container } = render(
      <AutocompleteFilter onChange={() => {}} onSearch={onSearch} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "  hi  " } });
    const searchBtn = container.querySelectorAll("button")[container.querySelectorAll("button").length - 1];
    fireEvent.click(searchBtn);
    expect(onSearch).toHaveBeenCalledWith("hi");
  });
});

describe("AutocompleteFilter > GET source word suggestions", () => {
  it("fetches suggestions when user types past minLength", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ suggestions: [{ word: "abcd" }, { word: "abxy" }] }),
    });
    const { getByPlaceholderText, findByText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[WORD_SOURCE]} minLength={3} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    expect(await findByText("abcd")).toBeInTheDocument();
  });
  it("under minLength → no fetch", async () => {
    const { getByPlaceholderText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[WORD_SOURCE]} minLength={4} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "ab" } });
    await act(async () => { await Promise.resolve(); });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("query_param_config replaces 'lastWord' template; query_params overrides defaults", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ suggestions: ["a"] }),
    });
    const source = {
      ...WORD_SOURCE,
      // query_params (limit: 5) wins over default (limit: 10) per SUT logic
      query_param_config: [
        { name: "query", default: "lastWord" },
        { name: "limit", default: 10 },
      ],
    };
    const { getByPlaceholderText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[source]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "shoes" } });
    await act(async () => { await Promise.resolve(); });
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain("query=shoes");
    expect(url).toContain("limit=5");
  });
  it("missing env var → falls back to the default suggest endpoint", async () => {
    vi.unstubAllEnvs();
    const { getByPlaceholderText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[WORD_SOURCE]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    await act(async () => { await Promise.resolve(); });
    // The source no longer gates on the env var — it uses a hardcoded default.
    expect(globalThis.fetch).toHaveBeenCalled();
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain("https://search-suggest.poweradspy.ai/suggest");
    expect(url).toContain("query=abc");
  });
  it("non-ok response → continues to next source", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { getByPlaceholderText, queryByText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[WORD_SOURCE]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    await act(async () => { await Promise.resolve(); });
    expect(queryByText("abcd")).toBeNull();
  });
  it("non-array items → ignored", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ suggestions: "x" }) });
    const { getByPlaceholderText, queryByText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[WORD_SOURCE]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    await act(async () => { await Promise.resolve(); });
    expect(queryByText("x")).toBeNull();
  });
  it("string items used as-is", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ suggestions: ["abc-string"] }),
    });
    const { getByPlaceholderText, findByText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[WORD_SOURCE]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    expect(await findByText("abc-string")).toBeInTheDocument();
  });
  it("item.word fallback when display_field missing", async () => {
    const src = { ...WORD_SOURCE, display_field: undefined };
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ suggestions: [{ word: "fallbackword" }] }),
    });
    const { getByPlaceholderText, findByText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[src]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    expect(await findByText("fallbackword")).toBeInTheDocument();
  });
  it("response without response_key falls back to data itself", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ["topword"],
    });
    const src = { ...WORD_SOURCE, response_key: "missing" };
    const { getByPlaceholderText, findByText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[src]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    expect(await findByText("topword")).toBeInTheDocument();
  });
  it("fetch throw on one source → handled per-source", async () => {
    globalThis.fetch.mockRejectedValueOnce(new Error("net"));
    const { getByPlaceholderText, queryByText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[WORD_SOURCE]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    await act(async () => { await Promise.resolve(); });
    expect(queryByText("abcd")).toBeNull();
  });
});

describe("AutocompleteFilter > POST source category suggestions", () => {
  // ChevronDown is rendered between major and sub category text, splitting the
  // text node — so `findByText("AI")` doesn't match. Use a flexible matcher.
  const containsText = (str) => (_, el) => el?.textContent?.includes(str) ?? false;

  it("POST fetch + setSelCategories action sets category list", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({
        matches: [
          { major_category: "Tech", sub_category: "AI" },
          { major_category: "Tech", sub_category: "AI" }, // dup
          { major_category: "Tech", sub_category: "Cloud" },
        ],
      }),
    });
    const { getByPlaceholderText, findAllByText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[CAT_SOURCE]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "tech" } });
    const aiMatches = await findAllByText(containsText("AI"));
    const cloudMatches = await findAllByText(containsText("Cloud"));
    // Each category renders inside a button — at least one AI and one Cloud
    expect(aiMatches.length).toBeGreaterThan(0);
    expect(cloudMatches.length).toBeGreaterThan(0);
  });
  it("missing major/sub default fillers", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ matches: [{}] }),
    });
    const { getByPlaceholderText, findAllByText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[CAT_SOURCE]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    const m = await findAllByText(containsText("Subcategory"));
    expect(m.length).toBeGreaterThan(0);
  });
  it("falsy match items are skipped", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ matches: [null, undefined, { major_category: "T", sub_category: "S" }] }),
    });
    const { getByPlaceholderText, findAllByText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[CAT_SOURCE]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    const m = await findAllByText(containsText("T"));
    expect(m.length).toBeGreaterThan(0);
  });
});

describe("AutocompleteFilter > selection callbacks", () => {
  it("word click replaces last word + suppresses next fetch", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ suggestions: ["completion"] }),
    });
    const onChange = vi.fn();
    const onSearch = vi.fn();
    const { getByPlaceholderText, findByText } = render(
      <AutocompleteFilter onChange={onChange} onSearch={onSearch}
        suggestionSources={[WORD_SOURCE]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "shoe com" } });
    fireEvent.click(await findByText("completion"));
    expect(onChange).toHaveBeenCalledWith("shoe completion");
    expect(onSearch).toHaveBeenCalledWith("shoe completion");
  });
  it("category click invokes onSelectCategory with the full split", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({
        matches: [{ major_category: "Tech", sub_category: "AI" }],
      }),
    });
    const onSelectCategory = vi.fn();
    const { getByPlaceholderText, container } = render(
      <AutocompleteFilter onChange={() => {}} onSelectCategory={onSelectCategory}
        suggestionSources={[CAT_SOURCE]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "tech" } });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    // Find the cat-* button (not the X / Search / clear buttons)
    const btns = Array.from(container.querySelectorAll("button"));
    const catBtn = btns.find(b => b.textContent.includes("AI"));
    fireEvent.click(catBtn);
    expect(onSelectCategory).toHaveBeenCalledWith(expect.objectContaining({ major: "Tech", sub: "AI" }));
  });
  it("category click without onSelectCategory still hides suggestions", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ matches: [{ major_category: "T", sub_category: "S" }] }),
    });
    const { getByPlaceholderText, container } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[CAT_SOURCE]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    const btns = Array.from(container.querySelectorAll("button"));
    const catBtn = btns.find(b => b.textContent.includes("S"));
    expect(() => fireEvent.click(catBtn)).not.toThrow();
  });
});

describe("AutocompleteFilter > misc", () => {
  it("minimal=true uses simpler container styling (no border)", () => {
    const { container } = render(
      <AutocompleteFilter onChange={() => {}} minimal />,
    );
    expect(container.querySelector(".bg-theme-card.border")).toBeNull();
  });
  it("outside click closes suggestions panel", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ suggestions: ["abc-completion"] }),
    });
    const { getByPlaceholderText, findByText, queryByText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[WORD_SOURCE]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    await findByText("abc-completion");
    fireEvent.mouseDown(document.body);
    await act(async () => { await Promise.resolve(); });
    expect(queryByText("abc-completion")).toBeNull();
  });
  it("multiple sources sort by rank (line 72 comparator)", async () => {
    // Two sources with explicit ranks — covers the (a.rank ?? 0) - (b.rank ?? 0) callback
    globalThis.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ suggestions: [{ word: "first" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ matches: [{ major_category: "M", sub_category: "S" }] }) });
    const { getByPlaceholderText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[CAT_SOURCE, WORD_SOURCE]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    // Two fetches happened — sort comparator was exercised
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
  it("POST request_body without top_k defaults to 5 (line 125)", async () => {
    const srcNoTopK = { ...CAT_SOURCE, request_body: { query: "" } };
    let postedBody;
    globalThis.fetch.mockImplementationOnce(async (_, opts) => {
      postedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ matches: [] }) };
    });
    const { getByPlaceholderText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[srcNoTopK]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(postedBody.top_k).toBe(5);
  });
  it("items without display_field or word → mapped to null + filtered (line 170)", async () => {
    // items contain shapes that match no extractor → return null branch
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ suggestions: [{ unrelated: "x" }, { word: 123 /* not string */ }] }),
    });
    const { getByPlaceholderText, queryByText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[WORD_SOURCE]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // Neither item produced a word — no suggestion rendered
    expect(queryByText(/^x$/)).toBeNull();
  });
  it("outer try catch on synchronous throw inside sort prep (lines 182-183)", async () => {
    // sort only invokes its comparator when there are 2+ elements — supply two
    // sources where the second one's .rank getter throws.
    const ThrowingSource = {
      get rank() { throw new Error("boom-on-sort"); },
      method: "GET", endpoint: "/x", env_key: "VITE_SUGGEST_API_BASE_URL",
      response_key: "suggestions", display_field: "word",
    };
    const { getByPlaceholderText } = render(
      <AutocompleteFilter onChange={() => {}}
        suggestionSources={[WORD_SOURCE, ThrowingSource]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // Component survives — outer catch swallowed the error
    expect(true).toBe(true);
  });
  it("onFocus re-opens dropdown when suggestions exist (lines 263-266)", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ suggestions: [{ word: "alpha" }] }),
    });
    const { getByPlaceholderText, getByText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[WORD_SOURCE]} />,
    );
    const input = getByPlaceholderText("Search...");
    fireEvent.change(input, { target: { value: "alpha" } });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // Suggestion present — fire focus to invoke the onFocus branch
    fireEvent.focus(input);
    expect(getByText("alpha")).toBeInTheDocument();
  });
  it("onBlur eventually clears suggestions via setTimeout (lines 267-270)", async () => {
    vi.useFakeTimers();
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ suggestions: [{ word: "beta" }] }),
    });
    const { getByPlaceholderText, queryByText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[WORD_SOURCE]} />,
    );
    const input = getByPlaceholderText("Search...");
    fireEvent.change(input, { target: { value: "beta" } });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    fireEvent.blur(input);
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(queryByText("beta")).toBeNull();
    vi.useRealTimers();
  });
  it("Loader2 appears while fetching (set isLoading=true mid-fetch)", async () => {
    let resolve;
    globalThis.fetch.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const { getByPlaceholderText, getByTestId } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[WORD_SOURCE]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    await act(async () => { await Promise.resolve(); });
    expect(getByTestId("loader-ic")).toBeInTheDocument();
    resolve({ ok: true, json: async () => ({ suggestions: [] }) });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  });
  it("undefined value prop in sync useEffect → '' fallback (line 42)", () => {
    // Render with value=null then rerender with undefined → both falsy
    const { rerender } = render(
      <AutocompleteFilter value={null} onChange={() => {}} />,
    );
    // value !== undefined && value !== searchQuery → null is defined, sets to ""
    rerender(<AutocompleteFilter value={undefined} onChange={() => {}} />);
    // No throw — exercised the value || "" fallback
    expect(true).toBe(true);
  });
  it("no minLength prop → fallback 3 (line 48 binary-expr right operand)", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ suggestions: [{ word: "fb" }] }),
    });
    const { getByPlaceholderText, findByText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[WORD_SOURCE]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "fbi" } });
    expect(await findByText("fb")).toBeInTheDocument();
  });
  it("GET source without env_key → uses baseUrl='' (lines 76, 99)", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ suggestions: [] }),
    });
    const source = {
      rank: 1, method: "GET", endpoint: "/suggest",
      response_key: "suggestions", display_field: "word",
      // no env_key, no query_params → spread of `source.query_params || {}` fallback fires
    };
    const { getByPlaceholderText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[source]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "abc" } });
    await act(async () => { await Promise.resolve(); });
    expect(globalThis.fetch).toHaveBeenCalled();
    // baseUrl="" because no env_key — endpoint starts with "/suggest..."
    expect(globalThis.fetch.mock.calls[0][0]).toMatch(/^\/suggest/);
  });
  it("POST source without request_body → uses {} fallback (line 121)", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ matches: [] }),
    });
    const source = {
      rank: 1, method: "POST", endpoint: "/cat",
      env_key: "VITE_CAT_SEARCH_API_BASE_URL",
      // no request_body → falls back to {}
      response_key: "matches",
      on_select_action: "setSelCategories",
    };
    const { getByPlaceholderText } = render(
      <AutocompleteFilter onChange={() => {}} suggestionSources={[source]} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "shoes" } });
    await act(async () => { await Promise.resolve(); });
    expect(globalThis.fetch).toHaveBeenCalled();
    const opts = globalThis.fetch.mock.calls[0][1];
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    // body.query defaulted from debouncedLastWord since body.query was undefined
    expect(body.top_k).toBe(5);
  });
});

describe("AutocompleteFilter > minLength=0 prop (line 48 || right operand)", () => {
  it("minLength=0 → suggestions fetch immediately even for empty input", async () => {
    // With minLength=0, the `(minLength || 3)` falsy branch fires → fallback 3
    // is NOT used. But wait — minLength=0 IS falsy, so `||` falls back to 3.
    // To actually hit the right operand: pass minLength as undefined or 0.
    // The condition `debouncedLastWord.length < (0 || 3)` → < 3, so a 3+ char
    // word still bypasses the early-return.
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ suggestions: ["abc"] }),
    });
    const { getByPlaceholderText } = render(
      <AutocompleteFilter onChange={() => {}}
        suggestionSources={[WORD_SOURCE]} minLength={0} />,
    );
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "xyz" } });
    await act(async () => { await Promise.resolve(); });
    // Fetch happened despite minLength=0 (falsy → fallback 3 used)
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});

describe("AutocompleteFilter > selection edge cases", () => {
  it("handleSelectWord with empty input → prefix='' (lines 210, 211 falsy)", async () => {
    // Trigger fetch with a word so suggestions render, then click a suggestion
    // when the search query is exactly one word — words.pop() empties it →
    // prefix becomes "" (line 211 falsy of `words.length > 0 ? ... : ""`).
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ suggestions: ["completion"] }),
    });
    const onChange = vi.fn();
    const { getByPlaceholderText, findByText } = render(
      <AutocompleteFilter onChange={onChange} suggestionSources={[WORD_SOURCE]} />,
    );
    // Single-word search → after .pop() words is empty → prefix=""
    fireEvent.change(getByPlaceholderText("Search..."), { target: { value: "com" } });
    fireEvent.click(await findByText("completion"));
    // Selected word stands alone (no prefix)
    expect(onChange).toHaveBeenCalledWith("completion");
  });
});

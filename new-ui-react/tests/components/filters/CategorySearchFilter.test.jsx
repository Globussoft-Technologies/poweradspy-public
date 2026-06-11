import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("lucide-react", () => ({
  Search: () => <i data-testid="search-ic" />,
  Check: () => <i data-testid="check-ic" />,
  Loader2: () => <i data-testid="loader-ic" />,
}));

vi.mock("../../../src/hooks/useDebounce", () => ({
  useDebounce: (v) => v, // passthrough — instant
}));

import CategorySearchFilter from "../../../src/components/filters/CategorySearchFilter.jsx";

beforeEach(() => {
  globalThis.fetch = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("CategorySearchFilter", () => {
  it("with no search → renders first 10 options from props", () => {
    const opts = Array.from({ length: 15 }, (_, i) => `O${i}`);
    const { getAllByRole } = render(
      <CategorySearchFilter options={opts} selected={[]} onChange={() => {}} />,
    );
    // 10 buttons (options) — search input is not a button
    expect(getAllByRole("button").length).toBe(10);
  });
  it("active option shows Check", () => {
    const { getAllByTestId } = render(
      <CategorySearchFilter options={["A"]} selected={["A"]} onChange={() => {}} />,
    );
    expect(getAllByTestId("check-ic").length).toBe(1);
  });
  it("clicking unselected adds it", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <CategorySearchFilter options={["A", "B"]} selected={["A"]} onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[1]);
    expect(onChange).toHaveBeenCalledWith(["A", "B"]);
  });
  it("clicking selected removes it", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      <CategorySearchFilter options={["A"]} selected={["A"]} onChange={onChange} />,
    );
    fireEvent.click(getAllByRole("button")[0]);
    expect(onChange).toHaveBeenCalledWith([]);
  });
  it("typing triggers fetch with debounced term", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        matches: [
          { major_category: "Tech", sub_category: "AI" },
          { major_category: "Tech", sub_category: "Cloud" },
          { major_category: "Tech", sub_category: "AI" }, // duplicate
        ],
      }),
    });
    const { getByPlaceholderText, findByText } = render(
      <CategorySearchFilter options={[]} selected={[]} onChange={() => {}} />,
    );
    fireEvent.change(getByPlaceholderText("Search categories..."), { target: { value: "tech" } });
    expect(await findByText("Tech > AI")).toBeInTheDocument();
    expect(await findByText("Tech > Cloud")).toBeInTheDocument();
  });
  it("empty matches array → 'No matches found.'", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ matches: [] }),
    });
    const { getByPlaceholderText, findByText } = render(
      <CategorySearchFilter options={[]} selected={[]} onChange={() => {}} />,
    );
    fireEvent.change(getByPlaceholderText("Search categories..."), { target: { value: "x" } });
    expect(await findByText("No matches found.")).toBeInTheDocument();
  });
  it("missing major_category/sub_category dropped", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({
        matches: [
          { major_category: "Tech", sub_category: "AI" },
          { major_category: "Only-Major" }, // missing sub
          { sub_category: "Only-Sub" },     // missing major
        ],
      }),
    });
    const { getByPlaceholderText, findByText, queryByText } = render(
      <CategorySearchFilter options={[]} selected={[]} onChange={() => {}} />,
    );
    fireEvent.change(getByPlaceholderText("Search categories..."), { target: { value: "x" } });
    expect(await findByText("Tech > AI")).toBeInTheDocument();
    expect(queryByText("Only-Major >")).toBeNull();
  });
  it("non-array .matches falls back to empty", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ matches: "not-array" }),
    });
    const { getByPlaceholderText, findByText } = render(
      <CategorySearchFilter options={[]} selected={[]} onChange={() => {}} />,
    );
    fireEvent.change(getByPlaceholderText("Search categories..."), { target: { value: "x" } });
    expect(await findByText("No matches found.")).toBeInTheDocument();
  });
  it("fetch throws → error logged + empty", async () => {
    globalThis.fetch.mockRejectedValueOnce(new Error("net"));
    const { getByPlaceholderText, findByText } = render(
      <CategorySearchFilter options={[]} selected={[]} onChange={() => {}} />,
    );
    fireEvent.change(getByPlaceholderText("Search categories..."), { target: { value: "x" } });
    expect(await findByText("No matches found.")).toBeInTheDocument();
    expect(console.error).toHaveBeenCalled();
  });
  it("fetch non-ok response → matches stay empty", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { getByPlaceholderText, findByText } = render(
      <CategorySearchFilter options={[]} selected={[]} onChange={() => {}} />,
    );
    fireEvent.change(getByPlaceholderText("Search categories..."), { target: { value: "x" } });
    expect(await findByText("No matches found.")).toBeInTheDocument();
  });
  it("clearing the search resets apiCategories", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ matches: [{ major_category: "T", sub_category: "S" }] }),
    });
    const { getByPlaceholderText, findByText, queryByText } = render(
      <CategorySearchFilter options={["FromProps"]} selected={[]} onChange={() => {}} />,
    );
    const input = getByPlaceholderText("Search categories...");
    fireEvent.change(input, { target: { value: "x" } });
    await findByText("T > S");
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } });
      await Promise.resolve();
    });
    // Now back to the props options (FromProps)
    expect(queryByText("T > S")).toBeNull();
  });
});

// NOTE: `return 0` guards on lines 31 and 37 of Calculator.jsx are unreachable —
// see https://github.com/Globussoft-Technologies/poweradspy/issues/253
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("react-icons/fa", () => ({
  FaCalculator: () => <i data-testid="calc-ic" />,
  FaImage: () => <i data-testid="image-ic" />,
  FaVideo: () => <i data-testid="video-ic" />,
  FaCoins: () => <i data-testid="coins-ic" />,
}));

import Calculator from "../../src/components/Calculator.jsx";

describe("Calculator", () => {
  it("renders header + 'Ready to calculate' empty state", () => {
    const { getByText } = render(<Calculator />);
    expect(getByText("Credit Estimator")).toBeInTheDocument();
    expect(getByText("Ready to calculate?")).toBeInTheDocument();
  });
  it("Calculate without amount shows 'Enter budget' error", () => {
    const { getByText, queryByText } = render(<Calculator />);
    fireEvent.click(getByText("Calculate"));
    expect(getByText("Enter budget")).toBeInTheDocument();
    expect(queryByText("Image Generation")).toBeNull();
  });
  it("Calculate with 0 amount shows error too", () => {
    const { getByText, getByPlaceholderText } = render(<Calculator />);
    fireEvent.change(getByPlaceholderText("Enter USD budget..."), { target: { value: "0" } });
    fireEvent.click(getByText("Calculate"));
    expect(getByText("Enter budget")).toBeInTheDocument();
  });
  it("Calculate with positive amount shows image + video sections with model rows", () => {
    const { getByText, getByPlaceholderText, getAllByText } = render(<Calculator />);
    fireEvent.change(getByPlaceholderText("Enter USD budget..."), { target: { value: "10" } });
    fireEvent.click(getByText("Calculate"));
    expect(getByText("Image Generation")).toBeInTheDocument();
    expect(getByText("Video Generation")).toBeInTheDocument();
    // 3 image models
    expect(getByText("Imagen")).toBeInTheDocument();
    expect(getByText("OpenAI")).toBeInTheDocument();
    expect(getByText("Nano Banana Pro")).toBeInTheDocument();
    // 6 video models
    expect(getByText("Sora 2")).toBeInTheDocument();
    expect(getByText("Veo 4K")).toBeInTheDocument();
  });
  it("Imagen at $10 USD → 200 images (10/0.05=200 credits / 1 per image)", () => {
    const { getByText, getByPlaceholderText } = render(<Calculator />);
    fireEvent.change(getByPlaceholderText("Enter USD budget..."), { target: { value: "10" } });
    fireEvent.click(getByText("Calculate"));
    expect(getByText("200")).toBeInTheDocument();
  });
  it("video duration >=60s shows minute/second breakdown", () => {
    const { getByText, getByPlaceholderText } = render(<Calculator />);
    // $10 = 200 credits / 2 credits/sec for Sora 2 = 100s
    fireEvent.change(getByPlaceholderText("Enter USD budget..."), { target: { value: "10" } });
    fireEvent.click(getByText("Calculate"));
    expect(getByText("100s")).toBeInTheDocument();
    expect(getByText("(1m 40s)")).toBeInTheDocument();
  });
  it("video duration <60s does NOT show minute breakdown", () => {
    const { queryByText, getByText, getByPlaceholderText } = render(<Calculator />);
    fireEvent.change(getByPlaceholderText("Enter USD budget..."), { target: { value: "2" } });
    fireEvent.click(getByText("Calculate"));
    // Sora 2 at $2 → 40 credits / 2 = 20s — no minute breakdown
    expect(queryByText(/\(\d+m \d+s\)/)).toBeNull();
  });
  it("Reset clears amount, error, calculated state", () => {
    const { getByText, getByPlaceholderText, queryByText } = render(<Calculator />);
    fireEvent.change(getByPlaceholderText("Enter USD budget..."), { target: { value: "10" } });
    fireEvent.click(getByText("Calculate"));
    expect(getByText("Image Generation")).toBeInTheDocument();
    fireEvent.click(getByText("Reset"));
    expect(getByPlaceholderText("Enter USD budget...").value).toBe("");
    expect(queryByText("Image Generation")).toBeNull();
    expect(getByText("Ready to calculate?")).toBeInTheDocument();
  });
  it("typing negative number is rejected (input change short-circuits)", () => {
    const { getByPlaceholderText } = render(<Calculator />);
    const input = getByPlaceholderText("Enter USD budget...");
    fireEvent.change(input, { target: { value: "-5" } });
    expect(input.value).toBe("");
  });
  it("amount over 100 billion is capped at 100000000000", () => {
    const { getByPlaceholderText } = render(<Calculator />);
    const input = getByPlaceholderText("Enter USD budget...");
    fireEvent.change(input, { target: { value: "100000000001" } });
    expect(input.value).toBe("100000000000");
  });
  it("after first Calculate, typing new amount auto-recalculates", () => {
    const { getByText, getByPlaceholderText } = render(<Calculator />);
    const input = getByPlaceholderText("Enter USD budget...");
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.click(getByText("Calculate"));
    expect(getByText("200")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "5" } });
    // 5/0.05 = 100 → still calculated
    expect(getByText("100")).toBeInTheDocument();
  });
  it("after Calculate then clearing input → reverts to empty-state", () => {
    const { getByText, getByPlaceholderText, queryByText } = render(<Calculator />);
    const input = getByPlaceholderText("Enter USD budget...");
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.click(getByText("Calculate"));
    fireEvent.change(input, { target: { value: "" } });
    expect(queryByText("Image Generation")).toBeNull();
    expect(getByText("Ready to calculate?")).toBeInTheDocument();
  });
  it("after Calculate then entering 0 → reverts to empty-state", () => {
    const { getByText, getByPlaceholderText, queryByText } = render(<Calculator />);
    const input = getByPlaceholderText("Enter USD budget...");
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.click(getByText("Calculate"));
    fireEvent.change(input, { target: { value: "0" } });
    expect(queryByText("Image Generation")).toBeNull();
  });
});

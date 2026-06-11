import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import UserCopyDataCard from "../../src/components/UserCopyDataCard.jsx";

describe("UserCopyDataCard", () => {
  it("returns null when data is undefined", () => {
    const { container } = render(<UserCopyDataCard />);
    expect(container.innerHTML).toBe("");
  });
  it("returns null when data.copy is not an array", () => {
    const { container } = render(<UserCopyDataCard data={{ copy: "not-array" }} />);
    expect(container.innerHTML).toBe("");
  });
  it("returns null when copy array has only empty objects", () => {
    const { container } = render(<UserCopyDataCard data={{ copy: [{}, {}] }} />);
    expect(container.innerHTML).toBe("");
  });
  it("renders Copy Data heading + key labels", () => {
    const data = {
      copy: [{
        "card-thing": {
          adId: "AD-1",
          component: "Card",
          copiedText: ["hello", "world"],
          count: 3,
          timestamp: "2025-03-01",
        },
      }],
    };
    const { getByText } = render(<UserCopyDataCard data={data} />);
    expect(getByText("Copy Data")).toBeInTheDocument();
    expect(getByText("AD-1")).toBeInTheDocument();
    expect(getByText("Card")).toBeInTheDocument();
    expect(getByText("hello||world")).toBeInTheDocument();
    expect(getByText("3")).toBeInTheDocument();
    expect(getByText("2025-03-01")).toBeInTheDocument();
    expect(getByText("Clicks Count:")).toBeInTheDocument();
  });
  it("key includes 'chats-chatbot-card' → renders 'ChatBot-Chats' + 'Copy Count:'", () => {
    const data = {
      copy: [{
        "user-chats-chatbot-card-1": {
          adId: "AD-2",
          component: "WhateverElse",
          copiedText: ["x"],
          count: 1,
          timestamp: "2025-04-04",
        },
      }],
    };
    const { getByText } = render(<UserCopyDataCard data={data} />);
    expect(getByText("ChatBot-Chats")).toBeInTheDocument();
    expect(getByText("Copy Count:")).toBeInTheDocument();
  });
  it("copiedText undefined → 'N/A'", () => {
    const data = {
      copy: [{ "card": { adId: "id" } }],
    };
    const { getAllByText } = render(<UserCopyDataCard data={data} />);
    expect(getAllByText("N/A").length).toBeGreaterThan(0);
  });
  it("falsy fields render 'N/A'", () => {
    const data = {
      copy: [{ "card": { adId: null, component: null, count: null, timestamp: null } }],
    };
    const { getAllByText } = render(<UserCopyDataCard data={data} />);
    // adId, component, count, timestamp, copiedText = up to 5 N/A
    expect(getAllByText("N/A").length).toBeGreaterThanOrEqual(4);
  });
  it("renders multiple copy entries and multiple keys per entry", () => {
    const data = {
      copy: [
        { "card-a": { adId: "1" }, "card-b": { adId: "2" } },
        { "card-c": { adId: "3" } },
      ],
    };
    const { getByText } = render(<UserCopyDataCard data={data} />);
    expect(getByText("1")).toBeInTheDocument();
    expect(getByText("2")).toBeInTheDocument();
    expect(getByText("3")).toBeInTheDocument();
  });
});

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import UserChatSession from "../../src/components/UserChatSessionCard.jsx";

describe("UserChatSessionCard", () => {
  it("returns null when data is undefined", () => {
    const { container } = render(<UserChatSession />);
    expect(container.innerHTML).toBe("");
  });
  it("returns null when clicks is empty", () => {
    const { container } = render(<UserChatSession data={{ clicks: [] }} />);
    expect(container.innerHTML).toBe("");
  });
  it("returns null when clicks contain only empty objects", () => {
    const { container } = render(<UserChatSession data={{ clicks: [{}, {}] }} />);
    expect(container.innerHTML).toBe("");
  });
  it("renders 'Click Data' heading when valid clicks exist", () => {
    const { getByText } = render(
      <UserChatSession data={{ clicks: [{ "anyKey": { adId: "AD-1" } }] }} />,
    );
    expect(getByText("Click Data")).toBeInTheDocument();
  });
  it.each([
    ["chatbot-card-Search Advertiser"],
    ["something-12345678901-piChart"],
    ["something-12345678901-lineChart"],
    ["12345678901"],
    ["chatbot-card-chatbot-header p-3"],
    ["chatbot-card-chatbot-button close"],
    ["chatbot-card-close-chat-history"],
    ["42"],
  ])("skips key matching exclusion pattern: %s", (key) => {
    const { queryByText } = render(
      <UserChatSession data={{ clicks: [{ [key]: { component: "X" } }] }} />,
    );
    expect(queryByText("X")).toBeNull();
  });
  it("renders chatBot-prefix card with innerText", () => {
    const { getByText } = render(
      <UserChatSession data={{ clicks: [{
        "chatBot-msg": { innerText: "Hello there", count: 5, timestamp: "ts1" },
      }] }} />,
    );
    expect(getByText("chatBot-msg")).toBeInTheDocument();
    expect(getByText("Hello there")).toBeInTheDocument();
    expect(getByText("5")).toBeInTheDocument();
    expect(getByText("ts1")).toBeInTheDocument();
  });
  it("renders chatbot-card-flex card with 'chatBot-FAQ' label + 'Selected-FAQ'", () => {
    const { getByText } = render(
      <UserChatSession data={{ clicks: [{
        "chatbot-card-flex": { innerText: "FAQ text", count: 1 },
      }] }} />,
    );
    expect(getByText("chatBot-FAQ")).toBeInTheDocument();
    expect(getByText("Selected-FAQ")).toBeInTheDocument();
    expect(getByText("FAQ text")).toBeInTheDocument();
  });
  it("renders Advertiser Search card", () => {
    const { getByText } = render(
      <UserChatSession data={{ clicks: [{
        "chatbot-card-id-abc123-AdvertiserValue": { advertiserSearchValue: "Nike Sale", timestamp: "tsAdv" },
      }] }} />,
    );
    expect(getByText("Advertiser Search")).toBeInTheDocument();
    expect(getByText("Nike Sale")).toBeInTheDocument();
    expect(getByText("tsAdv")).toBeInTheDocument();
  });
  it("renders default Ad Card with adId/component/innerText/count/timestamp", () => {
    const { getByText } = render(
      <UserChatSession data={{ clicks: [{
        "regular-key": {
          adId: "AD-5",
          component: "Card",
          innerText: "ClickedOn",
          count: 9,
          timestamp: "tsX",
        },
      }] }} />,
    );
    expect(getByText("regular-key")).toBeInTheDocument();
    expect(getByText("AD-5")).toBeInTheDocument();
    expect(getByText("Card")).toBeInTheDocument();
    expect(getByText("ClickedOn")).toBeInTheDocument();
    expect(getByText("9")).toBeInTheDocument();
    expect(getByText("tsX")).toBeInTheDocument();
  });
  it("missing fields → 'N/A' fallback", () => {
    const { getAllByText } = render(
      <UserChatSession data={{ clicks: [{ "regular-key": {} }] }} />,
    );
    // 5 N/As for adId, component, innerText, count, timestamp
    expect(getAllByText("N/A").length).toBeGreaterThanOrEqual(5);
  });
  it("chatBot card with missing innerText/count/timestamp → N/A", () => {
    const { getAllByText } = render(
      <UserChatSession data={{ clicks: [{ "chatBot-x": {} }] }} />,
    );
    expect(getAllByText("N/A").length).toBeGreaterThanOrEqual(2);
  });
  it("chatbot-card-flex card with missing values → N/A", () => {
    const { getAllByText } = render(
      <UserChatSession data={{ clicks: [{ "chatbot-card-flex": {} }] }} />,
    );
    expect(getAllByText("N/A").length).toBeGreaterThanOrEqual(2);
  });
  it("Advertiser Search card with missing values → N/A", () => {
    const { getAllByText } = render(
      <UserChatSession data={{ clicks: [{ "chatbot-card-id-x-AdvertiserValue": {} }] }} />,
    );
    expect(getAllByText("N/A").length).toBeGreaterThanOrEqual(2);
  });
  it("renders multiple chat sessions + multiple keys per session", () => {
    const { getByText } = render(
      <UserChatSession data={{ clicks: [
        { "regular-a": { adId: "ID-A" }, "regular-b": { adId: "ID-B" } },
        { "regular-c": { adId: "ID-C" } },
      ]}} />,
    );
    expect(getByText("ID-A")).toBeInTheDocument();
    expect(getByText("ID-B")).toBeInTheDocument();
    expect(getByText("ID-C")).toBeInTheDocument();
  });
  it("renders a mix of chatBot + Advertiser + default cards in one click obj", () => {
    const { getByText } = render(
      <UserChatSession data={{ clicks: [{
        "chatBot-1": { innerText: "Bot text" },
        "chatbot-card-id-abc-AdvertiserValue": { advertiserSearchValue: "Adv text" },
        "default-key": { adId: "AD-DEF" },
      }] }} />,
    );
    expect(getByText("Bot text")).toBeInTheDocument();
    expect(getByText("Adv text")).toBeInTheDocument();
    expect(getByText("AD-DEF")).toBeInTheDocument();
  });
});

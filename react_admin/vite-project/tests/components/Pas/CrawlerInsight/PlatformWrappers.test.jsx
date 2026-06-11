import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// Mock the shared GlobalUiComponent — emit the network prop as a data-attr
vi.mock("../../../../src/components/Pas/CrawlerInsight/GlobalUiComponent", () => ({
  default: ({ network }) => <div data-testid="global-ui" data-network={network} />,
}));

import Facebook from "../../../../src/components/Pas/CrawlerInsight/Facebook.jsx";
import GDN from "../../../../src/components/Pas/CrawlerInsight/GDN.jsx";
import Google from "../../../../src/components/Pas/CrawlerInsight/Google.jsx";
import Insta from "../../../../src/components/Pas/CrawlerInsight/Insta.jsx";
import Linkedin from "../../../../src/components/Pas/CrawlerInsight/Linkedin.jsx";
import Native from "../../../../src/components/Pas/CrawlerInsight/Native.jsx";
import Pinterest from "../../../../src/components/Pas/CrawlerInsight/Pinterest.jsx";
import Quora from "../../../../src/components/Pas/CrawlerInsight/Quora.jsx";
import Reddit from "../../../../src/components/Pas/CrawlerInsight/Reddit.jsx";
import Tiktok from "../../../../src/components/Pas/CrawlerInsight/Tiktok.jsx";
import Youtube from "../../../../src/components/Pas/CrawlerInsight/Youtube.jsx";

const cases = [
  { name: "Facebook", Component: Facebook, network: "facebook" },
  { name: "GDN", Component: GDN, network: "gdn" },
  { name: "Google", Component: Google, network: "google" },
  { name: "Insta", Component: Insta, network: "instagram" },
  { name: "Linkedin", Component: Linkedin, network: "linkedin" },
  { name: "Native", Component: Native, network: "native" },
  { name: "Pinterest", Component: Pinterest, network: "pinterest" },
  { name: "Quora", Component: Quora, network: "quora" },
  { name: "Reddit", Component: Reddit, network: "reddit" },
  { name: "Tiktok", Component: Tiktok, network: "tiktok" },
  { name: "Youtube", Component: Youtube, network: "youtube" },
];

describe("CrawlerInsight platform wrappers", () => {
  for (const { name, Component, network } of cases) {
    it(`${name} renders GlobalUiComponent with network=${network}`, () => {
      const { getByTestId } = render(<Component />);
      const el = getByTestId("global-ui");
      expect(el).toBeInTheDocument();
      expect(el.getAttribute("data-network")).toBe(network);
    });
  }
});

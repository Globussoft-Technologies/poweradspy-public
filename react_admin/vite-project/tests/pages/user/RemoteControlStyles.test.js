import { describe, it, expect } from "vitest";
import * as Styles from "../../../src/pages/user/RemoteControlStyles.js";

// All ~40 styled-components/keyframes/global-styles exports are constants —
// importing the module evaluates every template literal and counts as
// statement+line coverage. Each export is verified to be defined.

const expectedExports = [
  "fadeIn", "gradientBackground", "slideIn", "GlobalStyle",
  "Container", "Card", "Title", "Input", "Button",
  "PrimaryButton", "DangerButton", "SecondaryButton",
  "StatusIndicator", "ConnectedStatus", "DisconnectedStatus",
  "ConnectingStatus", "ReconnectingStatus", "StatsContainer", "StatBadge",
  "RemoteScreen", "ErrorMessage", "ControlPanel", "ControlButton",
  "HeroSection", "InputIcon", "LoginError", "LoginFooter",
  "LoginContainer", "LoginCard", "LoginButton",
  "InputLabel", "InputGroup", "HeroTitle", "HeroText",
  "UserProfile", "Avatar", "UserName",
  "LoginInput", "LoginTitle", "PasswordToggle",
];

describe("pages/user/RemoteControlStyles", () => {
  it("exposes every expected styled-component / keyframe / global-style export", () => {
    for (const name of expectedExports) {
      expect(Styles[name], `missing export: ${name}`).toBeDefined();
    }
  });

  it("export count matches the known surface (locks new exports in)", () => {
    expect(Object.keys(Styles).sort()).toEqual([...expectedExports].sort());
  });
});

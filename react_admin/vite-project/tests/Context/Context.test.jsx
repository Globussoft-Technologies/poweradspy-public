import { describe, it, expect } from "vitest";
import React from "react";
import AdminContext from "../../src/Context/Context";

describe("Context/Context", () => {
  it("exports a React Context", () => {
    expect(AdminContext).toBeDefined();
    expect(AdminContext.Provider).toBeDefined();
    expect(AdminContext.Consumer).toBeDefined();
  });
});

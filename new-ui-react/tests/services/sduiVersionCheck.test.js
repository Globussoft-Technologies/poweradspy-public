import { describe, it, expect } from "vitest";
import { parseVersion, isSchemaCompatible } from "../../src/services/sduiVersionCheck.js";
import { SUPPORTED_SCHEMA_MAJOR } from "../../src/constants/sduiVersions.js";

describe("services/sduiVersionCheck > parseVersion", () => {
  it("parses a full semver", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });
  it("missing minor/patch default to 0", () => {
    expect(parseVersion("4")).toEqual({ major: 4, minor: 0, patch: 0 });
  });
  it("non-numeric segments coerce to 0 via Number()", () => {
    expect(parseVersion("a.b.c")).toEqual({ major: 0, minor: 0, patch: 0 });
  });
  it("null/undefined → zeros", () => {
    expect(parseVersion(null)).toEqual({ major: 0, minor: 0, patch: 0 });
    expect(parseVersion(undefined)).toEqual({ major: 0, minor: 0, patch: 0 });
  });
  it("non-string types → zeros", () => {
    expect(parseVersion(123)).toEqual({ major: 0, minor: 0, patch: 0 });
    expect(parseVersion({})).toEqual({ major: 0, minor: 0, patch: 0 });
  });
  it("empty string → zeros", () => {
    expect(parseVersion("")).toEqual({ major: 0, minor: 0, patch: 0 });
  });
});

describe("services/sduiVersionCheck > isSchemaCompatible", () => {
  it("missing version → true (legacy backend)", () => {
    expect(isSchemaCompatible(undefined)).toBe(true);
    expect(isSchemaCompatible(null)).toBe(true);
    expect(isSchemaCompatible("")).toBe(true);
  });
  it("matching major → true", () => {
    expect(isSchemaCompatible(`${SUPPORTED_SCHEMA_MAJOR}.0.0`)).toBe(true);
    expect(isSchemaCompatible(`${SUPPORTED_SCHEMA_MAJOR}.5.99`)).toBe(true);
  });
  it("different major → false", () => {
    expect(isSchemaCompatible(`${SUPPORTED_SCHEMA_MAJOR + 1}.0.0`)).toBe(false);
  });
});

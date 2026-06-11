import { describe, it, expect } from "vitest";
import countryValidationService from "../../../core/countryData/countryData.validation.js";

describe("core/countryData/countryData.validation > addCountry", () => {
  it("accepts a fully valid payload", () => {
    const { error } = countryValidationService.addCountry({
      iso: "IN",
      name: "INDIA",
      nicename: "India",
      iso3: "IND",
      numcode: 356,
      phonecode: 91,
    });
    expect(error).toBeUndefined();
  });

  it("rejects when iso is missing (required)", () => {
    const { error } = countryValidationService.addCountry({
      name: "India",
      nicename: "India",
      iso3: "IND",
      numcode: 356,
      phonecode: 91,
    });
    expect(error).toBeDefined();
  });

  it("rejects iso of wrong length", () => {
    const { error } = countryValidationService.addCountry({
      iso: "USA",
      name: "USA",
      nicename: "United States",
      iso3: "USA",
      numcode: 840,
      phonecode: 1,
    });
    expect(error).toBeDefined();
  });

  it("rejects iso3 of wrong length", () => {
    const { error } = countryValidationService.addCountry({
      iso: "US",
      name: "USA",
      nicename: "United States",
      iso3: "US",
      numcode: 840,
      phonecode: 1,
    });
    expect(error).toBeDefined();
  });

  it("rejects numcode as non-integer", () => {
    const { error } = countryValidationService.addCountry({
      iso: "US",
      name: "USA",
      nicename: "United States",
      iso3: "USA",
      numcode: "x",
      phonecode: 1,
    });
    expect(error).toBeDefined();
  });
});

describe("core/countryData/countryData.validation > updateCountry", () => {
  it("accepts a fully valid payload", () => {
    const { error } = countryValidationService.updateCountry({
      iso: "IN",
      name: "INDIA",
      nicename: "India",
      iso3: "IND",
      numcode: 356,
      phonecode: 91,
    });
    expect(error).toBeUndefined();
  });

  it("accepts a partial payload (all optional)", () => {
    const { error } = countryValidationService.updateCountry({});
    expect(error).toBeUndefined();
  });

  it("rejects iso of wrong length on update", () => {
    const { error } = countryValidationService.updateCountry({ iso: "USA" });
    expect(error).toBeDefined();
  });

  it("rejects iso3 of wrong length on update", () => {
    const { error } = countryValidationService.updateCountry({ iso3: "X" });
    expect(error).toBeDefined();
  });
});

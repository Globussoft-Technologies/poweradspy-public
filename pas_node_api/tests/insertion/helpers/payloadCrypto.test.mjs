import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { xorEncryptDecrypt, decryptPayload, decodeUserPayload } = require("../../../src/insertion/helpers/payloadCrypto");

// Helper: produce the base64 string the extension would send for a given object.
const encrypt = (obj, key) =>
  xorEncryptDecrypt(Buffer.from(JSON.stringify(obj), "utf8"), key).toString("base64");

describe("insertion/helpers/payloadCrypto > xorEncryptDecrypt", () => {
  it("is symmetric (XOR twice with the same key restores the bytes)", () => {
    const key = "s3cr3t";
    const plain = Buffer.from("Hello, PowerAdSpy!", "utf8");
    const once = xorEncryptDecrypt(plain, key);
    const twice = xorEncryptDecrypt(once, key);
    expect(twice.equals(plain)).toBe(true);
    expect(once.equals(plain)).toBe(false);
  });

  it("returns the bytes unchanged when the key is empty", () => {
    const plain = Buffer.from("abc", "utf8");
    expect(xorEncryptDecrypt(plain, "").equals(plain)).toBe(true);
  });
});

describe("insertion/helpers/payloadCrypto > decryptPayload", () => {
  it("round-trips a JSON object", () => {
    const key = "myKey123";
    const obj = { instagram_id: "126", current_country: "India", name: "Matthew Dennis" };
    expect(decryptPayload(encrypt(obj, key), key)).toEqual(obj);
  });

  it("returns null on a non-JSON / empty payload", () => {
    expect(decryptPayload(undefined, "k")).toBeNull();
    expect(decryptPayload("", "k")).toBeNull();
    // valid base64 but garbage once XOR'd → not JSON
    expect(decryptPayload(Buffer.from("not json", "utf8").toString("base64"), "k")).toBeNull();
  });
});

describe("insertion/helpers/payloadCrypto > decodeUserPayload", () => {
  const key = "myKey123";

  it("uses the body verbatim when platform is set, != 3, and no data field", () => {
    const body = { facebook_id: "615", platform: "10", name: "x" };
    expect(decodeUserPayload(body, key)).toEqual(body);
  });

  it("decrypts body.data when a data field is present (even with platform set)", () => {
    const obj = { facebook_id: "615", name: "decrypted" };
    const out = decodeUserPayload({ platform: "10", data: encrypt(obj, key) }, key);
    expect(out).toEqual(obj);
  });

  it("decrypts when platform == 3 (scraper path)", () => {
    const obj = { facebook_id: "9", name: "scr" };
    expect(decodeUserPayload({ platform: 3, data: encrypt(obj, key) }, key)).toEqual(obj);
  });

  it("treats null platform/data as not-set (PHP isset semantics)", () => {
    // platform null → not the verbatim branch → decrypt path → bad data → {}
    expect(decodeUserPayload({ platform: null, data: null }, key)).toEqual({});
  });

  it("returns {} when decryption fails instead of throwing", () => {
    expect(decodeUserPayload({}, key)).toEqual({});
  });
});

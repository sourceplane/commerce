import { describe, expect, it } from "vitest";
import { isObject, isShopifyError } from "lib/type-guards";

// lib/type-guards.ts decides how shopifyFetch reshapes a failure: an
// Error-like value becomes {cause, status, message, query}, anything else is
// wrapped as {error, query}.

describe("isObject", () => {
  it("is true for plain objects only", () => {
    expect(isObject({})).toBe(true);
    expect(isObject(null)).toBe(false);
    expect(isObject([])).toBe(false);
    expect(isObject("x")).toBe(false);
  });
});

describe("isShopifyError", () => {
  it("accepts Error instances and anything with Error in its prototype chain", () => {
    expect(isShopifyError(new Error("boom"))).toBe(true);
    class ShopifyError extends Error {}
    expect(isShopifyError(new ShopifyError("boom"))).toBe(true);
    expect(isShopifyError(Object.create(Object.create(Error.prototype)))).toBe(true);
  });

  it("rejects GraphQL error payloads and primitives", () => {
    expect(isShopifyError({ message: "Unauthorized" })).toBe(false);
    expect(isShopifyError("boom")).toBe(false);
    expect(isShopifyError(undefined)).toBe(false);
  });
});

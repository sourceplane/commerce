import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/utils.ts: the URL helpers the search page and the cart modal use, and
// the Shopify env check. (The origin every absolute URL is built on is the
// request's own: app/site.ts, tests in site.test.ts.)

const env = { ...process.env };
const SHOPIFY_VARS = [
  "SHOPIFY_STORE_DOMAIN",
  "SHOPIFY_STOREFRONT_ACCESS_TOKEN",
] as const;

beforeEach(() => {
  vi.resetModules();
  for (const k of SHOPIFY_VARS) delete process.env[k];
});

afterEach(() => {
  for (const k of SHOPIFY_VARS) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
});

describe("createUrl", () => {
  it("appends the query string only when there are params", async () => {
    const { createUrl } = await import("lib/utils");
    expect(
      createUrl("/search", new URLSearchParams({ q: "shirt", sort: "price-asc" })),
    ).toBe("/search?q=shirt&sort=price-asc");
    expect(createUrl("/search", new URLSearchParams())).toBe("/search");
  });
});

describe("ensureStartsWith", () => {
  it("prefixes once", async () => {
    const { ensureStartsWith } = await import("lib/utils");
    expect(ensureStartsWith("demo.myshopify.com", "https://")).toBe(
      "https://demo.myshopify.com",
    );
    expect(ensureStartsWith("https://demo.myshopify.com", "https://")).toBe(
      "https://demo.myshopify.com",
    );
  });
});

describe("validateEnvironmentVariables", () => {
  it("names every missing Shopify variable", async () => {
    const { validateEnvironmentVariables } = await import("lib/utils");
    expect(() => validateEnvironmentVariables()).toThrow(
      /SHOPIFY_STORE_DOMAIN\nSHOPIFY_STOREFRONT_ACCESS_TOKEN/,
    );
  });

  it("rejects the .env.example placeholder brackets", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "[your-store].myshopify.com";
    process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN = "token";
    const { validateEnvironmentVariables } = await import("lib/utils");
    expect(() => validateEnvironmentVariables()).toThrow(/brackets/);
  });

  it("passes when both are set", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "demo.myshopify.com";
    process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN = "token";
    const { validateEnvironmentVariables } = await import("lib/utils");
    expect(() => validateEnvironmentVariables()).not.toThrow();
  });
});

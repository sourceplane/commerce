import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// app/api/revalidate → lib/shopify's `revalidate`: Shopify's webhook arrives
// with the topic in x-shopify-topic and the shared secret in the query. The
// HTTP status is always 200 (Shopify retries anything else); the decision is
// in the body and in which cache tag is revalidated.

const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
let topic = "unknown";

vi.mock("next/cache", () => ({
  unstable_cacheLife: () => {},
  unstable_cacheTag: () => {},
  cacheLife: () => {},
  cacheTag: () => {},
  revalidateTag,
  updateTag: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-shopify-topic": topic }),
  cookies: vi.fn(),
}));

function webhook(secret: string | undefined, shopifyTopic: string) {
  topic = shopifyTopic;
  const url = new URL("https://commerce-web-stage.example.workers.dev/api/revalidate");
  if (secret !== undefined) url.searchParams.set("secret", secret);
  return new NextRequest(url, { method: "POST" });
}

const env = process.env.SHOPIFY_REVALIDATION_SECRET;

beforeEach(() => {
  vi.resetModules();
  revalidateTag.mockReset();
  process.env.SHOPIFY_REVALIDATION_SECRET = "webhook-secret";
});

afterEach(() => {
  if (env === undefined) delete process.env.SHOPIFY_REVALIDATION_SECRET;
  else process.env.SHOPIFY_REVALIDATION_SECRET = env;
});

describe("revalidate (lib/shopify)", () => {
  it("refuses a missing or wrong secret without touching the cache", async () => {
    const { revalidate } = await import("lib/shopify");
    for (const secret of [undefined, "", "nope"]) {
      const res = await revalidate(webhook(secret, "products/update"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 401 });
    }
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("revalidates the products tag on product webhooks", async () => {
    const { revalidate } = await import("lib/shopify");
    const res = await revalidate(webhook("webhook-secret", "products/update"));
    expect(await res.json()).toMatchObject({ status: 200, revalidated: true });
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith("products", "seconds");
  });

  it("revalidates the collections tag on collection webhooks", async () => {
    const { revalidate } = await import("lib/shopify");
    await revalidate(webhook("webhook-secret", "collections/delete"));
    expect(revalidateTag).toHaveBeenCalledWith("collections", "seconds");
  });

  it("acknowledges other topics without revalidating", async () => {
    const { revalidate } = await import("lib/shopify");
    const res = await revalidate(webhook("webhook-secret", "orders/create"));
    expect(await res.json()).toEqual({ status: 200 });
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe("POST /api/revalidate", () => {
  it("delegates to lib/shopify's revalidate", async () => {
    const { POST } = await import("app/api/revalidate/route");
    const res = await POST(webhook("webhook-secret", "products/create"));
    expect(await res.json()).toMatchObject({ revalidated: true });
    expect(revalidateTag).toHaveBeenCalledWith("products", "seconds");
  });
});

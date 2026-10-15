import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/demo: the bundled catalogue a storefront serves until a Shopify store is
// connected, and its cookie cart. The catalogue must be internally consistent
// (every collection names real products, every variant real options, every
// image a file the Worker serves), and the cart must price from the
// catalogue, never from the cookie.

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
  headers: vi.fn(),
}));

beforeEach(() => jar.clear());

describe("the demo catalogue", () => {
  it("is consistent with itself and with public/demo", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { COLLECTIONS, MENUS, PRODUCTS } = await import("lib/demo/catalogue");
    const handles = new Set(PRODUCTS.map((p) => p.handle));
    expect(handles.size).toBe(PRODUCTS.length);
    for (const c of COLLECTIONS) {
      for (const h of c.products) expect(handles, `${c.collection.handle} → ${h}`).toContain(h);
    }
    const publicDir = path.resolve(__dirname, "../../../apps/web/public");
    for (const p of PRODUCTS) {
      expect(p.variants.length).toBeGreaterThan(0);
      for (const v of p.variants) {
        for (const o of v.selectedOptions) {
          if (o.name === "Title") continue;
          expect(p.options.find((x) => x.name === o.name)?.values).toContain(o.value);
        }
      }
      for (const img of p.images) {
        expect(fs.existsSync(path.join(publicDir, img.url)), img.url).toBe(true);
      }
    }
    // The home page's two collections, which upstream hides from search.
    expect(COLLECTIONS.map((c) => c.collection.handle)).toEqual(
      expect.arrayContaining(["hidden-homepage-featured-items", "hidden-homepage-carousel"]),
    );
    for (const menu of Object.values(MENUS)) {
      for (const item of menu) expect(item.path.startsWith("/")).toBe(true);
    }
  });

  it("searches and sorts the way the search page asks", async () => {
    const demo = await import("lib/demo");
    expect((await demo.getProducts({ query: "mug" })).map((p) => p.handle)).toEqual(["cache-mug"]);
    expect(await demo.getProducts({ query: "no such thing" })).toEqual([]);
    const byPrice = await demo.getProducts({ sortKey: "PRICE" });
    const prices = byPrice.map((p) => Number(p.priceRange.minVariantPrice.amount));
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    const desc = await demo.getProducts({ sortKey: "PRICE", reverse: true });
    expect(desc[0]!.handle).toBe(byPrice[byPrice.length - 1]!.handle);
    expect((await demo.getProducts({ sortKey: "BEST_SELLING" }))[0]!.handle).toBe("cloud-tee");
  });

  it("recommends other products, never the one being viewed", async () => {
    const demo = await import("lib/demo");
    const tee = (await demo.getProduct("cloud-tee"))!;
    const recs = await demo.getProductRecommendations(tee.id);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.map((p) => p.handle)).not.toContain("cloud-tee");
  });
});

describe("the cookie cart", () => {
  it("starts empty, and is a cart rather than undefined", async () => {
    const demo = await import("lib/demo");
    const cart = await demo.getCart();
    expect(cart.lines).toEqual([]);
    expect(cart.totalQuantity).toBe(0);
    expect(cart.checkoutUrl).toBe("/checkout");
  });

  it("adds, merges, prices from the catalogue, updates and removes", async () => {
    const demo = await import("lib/demo");
    const tee = (await demo.getProduct("cloud-tee"))!;
    const blackM = tee.variants.find((v) => v.title === "Black / M")!;
    await demo.addToCart([{ merchandiseId: blackM.id, quantity: 1 }]);
    await demo.addToCart([{ merchandiseId: blackM.id, quantity: 2 }]);
    await demo.addToCart([{ merchandiseId: "demo-cache-mug", quantity: 1 }]);
    let cart = await demo.getCart();
    expect(cart.totalQuantity).toBe(4);
    expect(cart.cost.totalAmount.amount).toBe((3 * 25 + 15).toFixed(2));
    expect(cart.lines.find((l) => l.merchandise.id === blackM.id)?.merchandise.product.handle).toBe(
      "cloud-tee",
    );

    cart = await demo.updateCart([{ id: blackM.id, merchandiseId: blackM.id, quantity: 1 }]);
    expect(cart.totalQuantity).toBe(2);
    cart = await demo.removeFromCart(["demo-cache-mug"]);
    expect(cart.lines.map((l) => l.merchandise.id)).toEqual([blackM.id]);
    cart = await demo.updateCart([{ id: blackM.id, merchandiseId: blackM.id, quantity: 0 }]);
    expect(cart.lines).toEqual([]);
  });

  it("refuses an unknown or sold-out variant", async () => {
    const demo = await import("lib/demo");
    await expect(demo.addToCart([{ merchandiseId: "nope", quantity: 1 }])).rejects.toThrow(/Unknown/);
    const hoodie = (await demo.getProduct("edge-hoodie"))!;
    const xl = hoodie.variants.find((v) => v.title === "XL")!;
    expect(xl.availableForSale).toBe(false);
    await expect(demo.addToCart([{ merchandiseId: xl.id, quantity: 1 }])).rejects.toThrow(/Out of stock/);
  });

  it("drops what a tampered cookie claims, and never trusts its prices", async () => {
    const { parseLines, toCart } = await import("lib/demo");
    expect(parseLines("not json").size).toBe(0);
    expect(parseLines(JSON.stringify({ a: 1 })).size).toBe(0);
    const lines = parseLines(
      JSON.stringify([
        ["demo-cache-mug", 2],
        ["demo-unknown", 1],
        ["demo-worker-cap", -3],
        ["demo-bucket-tote", 1.5],
        ["demo-origin-sticker-pack", 10_000],
      ]),
    );
    expect([...lines.entries()]).toEqual([
      ["demo-cache-mug", 2],
      ["demo-origin-sticker-pack", 99],
    ]);
    expect(toCart(lines).cost.totalAmount.amount).toBe((2 * 15 + 99 * 6).toFixed(2));
  });
});

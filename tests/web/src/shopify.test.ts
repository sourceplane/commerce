import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/shopify/index.ts without a network: the Storefront request shape, the
// menu/collection/product reshaping, and the "Shopify not configured" guards
// upstream relies on at build time.

vi.mock("next/cache", () => ({
  unstable_cacheLife: () => {},
  unstable_cacheTag: () => {},
  cacheLife: () => {},
  cacheTag: () => {},
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(),
  cookies: vi.fn(),
}));

const fetchMock = vi.fn();

function reply(data: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

const env = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.SHOPIFY_STORE_DOMAIN = "demo-store.myshopify.com";
  process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN = "storefront-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_STOREFRONT_ACCESS_TOKEN"]) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
});

const product = (handle: string, tags: string[] = []) => ({
  id: `gid://shopify/Product/${handle}`,
  handle,
  availableForSale: true,
  title: handle.toUpperCase(),
  description: "",
  descriptionHtml: "",
  options: [],
  priceRange: {
    maxVariantPrice: { amount: "20.0", currencyCode: "USD" },
    minVariantPrice: { amount: "10.0", currencyCode: "USD" },
  },
  variants: {
    edges: [
      {
        node: {
          id: `gid://shopify/ProductVariant/${handle}-1`,
          title: "Default Title",
          availableForSale: true,
          selectedOptions: [],
          price: { amount: "10.0", currencyCode: "USD" },
        },
      },
    ],
  },
  featuredImage: {
    url: `https://cdn.shopify.com/s/files/1/${handle}-front.jpg`,
    altText: "",
    width: 1,
    height: 1,
  },
  images: {
    edges: [
      {
        node: {
          url: `https://cdn.shopify.com/s/files/1/${handle}-front.jpg`,
          altText: "",
          width: 1,
          height: 1,
        },
      },
      {
        node: {
          url: `https://cdn.shopify.com/s/files/1/${handle}-back.jpg`,
          altText: "Back",
          width: 1,
          height: 1,
        },
      },
    ],
  },
  seo: { title: "", description: "" },
  tags,
  updatedAt: "2026-01-01T00:00:00Z",
});

describe("shopifyFetch", () => {
  it("posts the query to the store's Storefront endpoint with the access token", async () => {
    reply({ data: { menu: { items: [] } } });
    const { getMenu } = await import("lib/shopify");
    await getMenu("next-js-frontend-header-menu");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://demo-store.myshopify.com/api/2023-01/graphql.json");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Shopify-Storefront-Access-Token"]).toBe("storefront-token");
    expect(JSON.parse(init.body).variables).toEqual({
      handle: "next-js-frontend-header-menu",
    });
  });

  it("surfaces a GraphQL error payload with the query that caused it", async () => {
    reply({ errors: [{ message: "Unauthorized" }] });
    const { getMenu } = await import("lib/shopify");
    await expect(getMenu("x")).rejects.toMatchObject({
      error: { message: "Unauthorized" },
      query: expect.stringContaining("menu"),
    });
  });
});

describe("getMenu", () => {
  it("rewrites Shopify URLs to storefront paths", async () => {
    reply({
      data: {
        menu: {
          items: [
            { title: "All", url: "https://demo-store.myshopify.com/collections/all" },
            { title: "Shirts", url: "https://demo-store.myshopify.com/collections/shirts" },
            { title: "About", url: "https://demo-store.myshopify.com/pages/about" },
          ],
        },
      },
    });
    const { getMenu } = await import("lib/shopify");
    expect(await getMenu("next-js-frontend-header-menu")).toEqual([
      { title: "All", path: "/search/all" },
      { title: "Shirts", path: "/search/shirts" },
      { title: "About", path: "/about" },
    ]);
  });
});

describe("getCollections", () => {
  it("prepends the synthetic All collection and hides hidden-* collections", async () => {
    const collection = (handle: string) => ({
      node: {
        handle,
        title: handle,
        description: "",
        seo: { title: "", description: "" },
        updatedAt: "2026-01-01T00:00:00Z",
      },
    });
    reply({
      data: {
        collections: {
          edges: [collection("hidden-homepage-carousel"), collection("shirts")],
        },
      },
    });
    const { getCollections } = await import("lib/shopify");
    const collections = await getCollections();
    expect(collections.map((c) => [c.handle, c.path])).toEqual([
      ["", "/search"],
      ["shirts", "/search/shirts"],
    ]);
  });
});

describe("getProduct and getProducts", () => {
  it("flattens image and variant connections and fills missing alt text", async () => {
    reply({ data: { product: product("tee") } });
    const { getProduct } = await import("lib/shopify");
    const tee = (await getProduct("tee"))!;
    expect(tee.variants).toHaveLength(1);
    expect(tee.variants[0]!.id).toBe("gid://shopify/ProductVariant/tee-1");
    expect(tee.images.map((i) => i.altText)).toEqual(["TEE - tee-front", "Back"]);
  });

  it("filters products tagged nextjs-frontend-hidden out of listings", async () => {
    reply({
      data: {
        products: {
          edges: [
            { node: product("tee") },
            { node: product("secret", ["nextjs-frontend-hidden"]) },
          ],
        },
      },
    });
    const { getProducts } = await import("lib/shopify");
    const products = await getProducts({ query: "" });
    expect(products.map((p) => p.handle)).toEqual(["tee"]);
  });
});

describe("without a configured store", () => {
  it("every reader answers from the bundled demo catalogue, never calling Shopify", async () => {
    delete process.env.SHOPIFY_STORE_DOMAIN;
    const lib = await import("lib/shopify");
    expect(lib.isShopifyConfigured()).toBe(false);
    expect((await lib.getMenu("next-js-frontend-header-menu")).map((m) => m.path)).toEqual([
      "/search",
      "/search/apparel",
      "/search/accessories",
    ]);
    expect(
      await lib.getCollectionProducts({ collection: "hidden-homepage-featured-items" }),
    ).toHaveLength(3);
    expect((await lib.getProduct("cloud-tee"))?.title).toBe("Cloud Tee");
    expect(await lib.getProduct("no-such-product")).toBeUndefined();
    expect((await lib.getCollections()).map((c) => c.handle)).toEqual([
      "",
      "apparel",
      "accessories",
    ]);
    expect((await lib.getPage("about"))?.title).toBe("About this store");
    expect(await lib.getPage("no-such-page")).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with a store, the same readers go to Shopify", async () => {
    reply({ data: { product: product("tee") } });
    const lib = await import("lib/shopify");
    expect(lib.isShopifyConfigured()).toBe(true);
    expect((await lib.getProduct("tee"))?.handle).toBe("tee");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

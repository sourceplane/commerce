import type {
  Collection,
  Image,
  Menu,
  Page,
  Product,
  ProductOption,
  ProductVariant,
} from "lib/shopify/types";

// THE BUNDLED DEMO CATALOGUE. The storefront serves it whenever no Shopify
// store is connected (no SHOPIFY_STORE_DOMAIN), so a fresh deploy renders a
// real home page, real product pages and a working cart with no third-party
// key. The shapes are lib/shopify's own types, so every page and component
// renders it exactly as it renders a Shopify store. The images are SVGs in
// public/demo, served by the Worker's static assets.
//
// Replace it by connecting a store (README, "Connecting Shopify"); nothing
// here is read once one is.

const UPDATED_AT = "2026-10-01T00:00:00Z";
const CURRENCY = "USD";

type Seed = {
  handle: string;
  title: string;
  description: string;
  price: number;
  // Lower sells better: the order "Trending" sorts by.
  rank: number;
  createdAt: string;
  tags: string[];
  // Option name → values; none means a single "Default Title" variant.
  options?: Record<string, string[]>;
  // Option combinations that are out of stock, as "Value / Value".
  soldOut?: string[];
  // One image per value of this option (`${handle}-${value}.svg`), or the
  // product's single image.
  imageBy?: string;
};

const SEEDS: Seed[] = [
  {
    handle: "cloud-tee",
    title: "Cloud Tee",
    description:
      "A heavyweight cotton tee with a single cloud on the chest. Boxy fit, ribbed collar, printed to order.",
    price: 25,
    rank: 1,
    createdAt: "2026-09-01T00:00:00Z",
    tags: ["apparel", "shirt"],
    options: { Color: ["Black", "White"], Size: ["S", "M", "L"] },
    imageBy: "Color",
  },
  {
    handle: "edge-hoodie",
    title: "Edge Hoodie",
    description:
      "A brushed-fleece hoodie for cold server rooms. Kangaroo pocket, lined hood, the edge glyph on the sleeve.",
    price: 60,
    rank: 2,
    createdAt: "2026-09-08T00:00:00Z",
    tags: ["apparel", "hoodie"],
    options: { Size: ["S", "M", "L", "XL"] },
    soldOut: ["XL"],
  },
  {
    handle: "worker-cap",
    title: "Worker Cap",
    description:
      "A six-panel cotton twill cap with an embroidered bolt. One size, adjustable strap.",
    price: 22,
    rank: 4,
    createdAt: "2026-08-20T00:00:00Z",
    tags: ["apparel", "hat"],
  },
  {
    handle: "cache-mug",
    title: "Cache Mug",
    description:
      "A 12 oz stoneware mug that keeps the first pour warm. Dishwasher safe; the glaze is the colour of a cache hit.",
    price: 15,
    rank: 3,
    createdAt: "2026-09-15T00:00:00Z",
    tags: ["accessories", "mug"],
  },
  {
    handle: "bucket-tote",
    title: "Bucket Tote",
    description:
      "A canvas tote with room for everything you meant to put in object storage. Reinforced handles, inside pocket.",
    price: 18,
    rank: 5,
    createdAt: "2026-07-30T00:00:00Z",
    tags: ["accessories", "bag"],
  },
  {
    handle: "origin-sticker-pack",
    title: "Origin Sticker Pack",
    description:
      "Six die-cut vinyl stickers for the laptop that runs the origin. Weatherproof, matte finish.",
    price: 6,
    rank: 6,
    createdAt: "2026-09-22T00:00:00Z",
    tags: ["accessories", "stickers"],
  },
];

const money = (amount: number) => ({
  amount: amount.toFixed(2),
  currencyCode: CURRENCY,
});

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const image = (file: string, altText: string): Image => ({
  url: `/demo/${file}.svg`,
  altText,
  width: 1024,
  height: 1024,
});

function combinations(options: Record<string, string[]>) {
  let out: { name: string; value: string }[][] = [[]];
  for (const [name, values] of Object.entries(options)) {
    out = out.flatMap((combo) =>
      values.map((value) => [...combo, { name, value }]),
    );
  }
  return out;
}

function toProduct(seed: Seed): Product {
  const options: ProductOption[] = Object.entries(seed.options ?? {}).map(
    ([name, values]) => ({
      id: `demo-${seed.handle}-${slug(name)}`,
      name,
      values,
    }),
  );
  const variants: ProductVariant[] = seed.options
    ? combinations(seed.options).map((selectedOptions) => {
        const title = selectedOptions.map((o) => o.value).join(" / ");
        return {
          id: `demo-${seed.handle}-${slug(title)}`,
          title,
          availableForSale: !(seed.soldOut ?? []).includes(title),
          selectedOptions,
          price: money(seed.price),
        };
      })
    : [
        {
          id: `demo-${seed.handle}`,
          title: "Default Title",
          availableForSale: true,
          selectedOptions: [{ name: "Title", value: "Default Title" }],
          price: money(seed.price),
        },
      ];
  const images = seed.imageBy
    ? seed.options![seed.imageBy]!.map((value) =>
        image(`${seed.handle}-${slug(value)}`, `${seed.title} — ${value}`),
      )
    : [image(seed.handle, seed.title)];
  return {
    id: `demo-${seed.handle}`,
    handle: seed.handle,
    availableForSale: variants.some((v) => v.availableForSale),
    title: seed.title,
    description: seed.description,
    descriptionHtml: `<p>${seed.description}</p>`,
    options,
    priceRange: {
      maxVariantPrice: money(seed.price),
      minVariantPrice: money(seed.price),
    },
    variants,
    featuredImage: images[0]!,
    images,
    seo: { title: seed.title, description: seed.description },
    tags: seed.tags,
    updatedAt: UPDATED_AT,
  };
}

export const PRODUCTS: Product[] = SEEDS.map(toProduct);

// What the storefront sorts by, beyond the product itself.
export const RANK = new Map(SEEDS.map((s) => [s.handle, s.rank]));
export const CREATED_AT = new Map(SEEDS.map((s) => [s.handle, s.createdAt]));

const collection = (
  handle: string,
  title: string,
  description: string,
): Collection => ({
  handle,
  title,
  description,
  seo: { title, description },
  path: `/search/${handle}`,
  updatedAt: UPDATED_AT,
});

// Collection handle → its products, in display order. The two `hidden-*`
// collections are the ones the home page reads (upstream's convention): they
// never appear in the search page's list.
export const COLLECTIONS: { collection: Collection; products: string[] }[] = [
  {
    collection: collection("apparel", "Apparel", "Tees, hoodies and caps."),
    products: ["cloud-tee", "edge-hoodie", "worker-cap"],
  },
  {
    collection: collection(
      "accessories",
      "Accessories",
      "Mugs, totes and stickers.",
    ),
    products: ["cache-mug", "bucket-tote", "origin-sticker-pack"],
  },
  {
    collection: collection(
      "hidden-homepage-featured-items",
      "Featured",
      "The three products on the home page's grid.",
    ),
    products: ["cloud-tee", "edge-hoodie", "cache-mug"],
  },
  {
    collection: collection(
      "hidden-homepage-carousel",
      "Carousel",
      "The products on the home page's carousel.",
    ),
    products: [
      "worker-cap",
      "bucket-tote",
      "origin-sticker-pack",
      "cloud-tee",
      "edge-hoodie",
      "cache-mug",
    ],
  },
];

export const MENUS: Record<string, Menu[]> = {
  "next-js-frontend-header-menu": [
    { title: "All", path: "/search" },
    { title: "Apparel", path: "/search/apparel" },
    { title: "Accessories", path: "/search/accessories" },
  ],
  "next-js-frontend-footer-menu": [
    { title: "Home", path: "/" },
    { title: "About", path: "/about" },
    { title: "Shipping & returns", path: "/shipping-returns" },
    { title: "Your cart", path: "/cart" },
  ],
};

const page = (handle: string, title: string, body: string): Page => ({
  id: `demo-page-${handle}`,
  title,
  handle,
  body,
  bodySummary: body.replace(/<[^>]+>/g, "").slice(0, 160),
  seo: { title, description: body.replace(/<[^>]+>/g, "").slice(0, 160) },
  createdAt: UPDATED_AT,
  updatedAt: UPDATED_AT,
});

export const PAGES: Page[] = [
  page(
    "about",
    "About this store",
    [
      "<p>This storefront is showing its <strong>demo catalogue</strong>: six sample products bundled with the site, so it renders and takes a cart from its very first deploy.</p>",
      "<p>No store backend and no payment provider are connected yet. Browsing, search and the cart all work; the cart is kept in a cookie on your device, and checkout asks for a payment provider instead of taking an order.</p>",
      "<p>The owner replaces the demo by connecting a Shopify store: products, collections, menus, pages and the cart then come from Shopify, and Shopify's hosted checkout takes payment.</p>",
    ].join(""),
  ),
  page(
    "shipping-returns",
    "Shipping & returns",
    [
      "<p>Nothing ships from the demo catalogue: there is no checkout until a payment provider is connected.</p>",
      "<p>Once the store is connected to Shopify, this page is the store's own Shopify page with the same handle.</p>",
    ].join(""),
  ),
];

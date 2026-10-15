import { cookies } from "next/headers";
import type {
  Cart,
  CartItem,
  Collection,
  Menu,
  Page,
  Product,
} from "lib/shopify/types";
import {
  COLLECTIONS,
  CREATED_AT,
  MENUS,
  PAGES,
  PRODUCTS,
  RANK,
} from "./catalogue";

// The demo provider: lib/shopify's readers and cart operations over the
// bundled catalogue (./catalogue.ts), for a storefront with no Shopify store
// connected. lib/shopify calls these in its place, one for one, so pages and
// components never know which one answered.
//
// The cart is a cookie: no store, no session, nothing server-side. Each line
// is a variant id and a quantity; prices are always read back from the
// catalogue, never from the cookie.

export const DEMO_CART_COOKIE = "demo-cart";
export const DEMO_CHECKOUT_URL = "/checkout";
const MAX_QUANTITY = 99;
const MAX_LINES = 50;

const byHandle = new Map(PRODUCTS.map((p) => [p.handle, p]));
const variants = new Map(
  PRODUCTS.flatMap((p) =>
    p.variants.map((v) => [v.id, { product: p, variant: v }] as const),
  ),
);

// ── catalogue ────────────────────────────────────────────────────────────

const ALL: Collection = {
  handle: "",
  title: "All",
  description: "All products",
  seo: { title: "All", description: "All products" },
  path: "/search",
  updatedAt: "2026-10-01T00:00:00Z",
};

function sorted(
  products: Product[],
  sortKey?: string,
  reverse?: boolean,
): Product[] {
  const out = products.slice();
  switch (sortKey) {
    case "BEST_SELLING":
      out.sort((a, b) => (RANK.get(a.handle) ?? 0) - (RANK.get(b.handle) ?? 0));
      break;
    case "CREATED_AT":
    case "CREATED":
      out.sort((a, b) =>
        (CREATED_AT.get(a.handle) ?? "").localeCompare(
          CREATED_AT.get(b.handle) ?? "",
        ),
      );
      break;
    case "PRICE":
      out.sort(
        (a, b) =>
          Number(a.priceRange.minVariantPrice.amount) -
          Number(b.priceRange.minVariantPrice.amount),
      );
      break;
    default:
      break; // RELEVANCE: catalogue order
  }
  return reverse ? out.reverse() : out;
}

export async function getCollection(
  handle: string,
): Promise<Collection | undefined> {
  return COLLECTIONS.find((c) => c.collection.handle === handle)?.collection;
}

export async function getCollectionProducts({
  collection,
  reverse,
  sortKey,
}: {
  collection: string;
  reverse?: boolean;
  sortKey?: string;
}): Promise<Product[]> {
  const entry = COLLECTIONS.find((c) => c.collection.handle === collection);
  if (!entry) return [];
  return sorted(
    entry.products
      .map((h) => byHandle.get(h))
      .filter((p): p is Product => Boolean(p)),
    sortKey,
    reverse,
  );
}

export async function getCollections(): Promise<Collection[]> {
  return [
    ALL,
    ...COLLECTIONS.map((c) => c.collection).filter(
      (c) => !c.handle.startsWith("hidden"),
    ),
  ];
}

export async function getMenu(handle: string): Promise<Menu[]> {
  return MENUS[handle] ?? [];
}

export async function getPage(handle: string): Promise<Page | undefined> {
  return PAGES.find((p) => p.handle === handle);
}

export async function getPages(): Promise<Page[]> {
  return PAGES;
}

export async function getProduct(handle: string): Promise<Product | undefined> {
  return byHandle.get(handle);
}

export async function getProductRecommendations(
  productId: string,
): Promise<Product[]> {
  const product = PRODUCTS.find((p) => p.id === productId);
  if (!product) return [];
  const siblings = COLLECTIONS.filter(
    (c) =>
      !c.collection.handle.startsWith("hidden") &&
      c.products.includes(product.handle),
  ).flatMap((c) => c.products);
  const others = PRODUCTS.map((p) => p.handle).filter(
    (h) => !siblings.includes(h),
  );
  return [...siblings, ...others]
    .filter((h, i, all) => h !== product.handle && all.indexOf(h) === i)
    .slice(0, 4)
    .map((h) => byHandle.get(h)!);
}

export async function getProducts({
  query,
  reverse,
  sortKey,
}: {
  query?: string;
  reverse?: boolean;
  sortKey?: string;
}): Promise<Product[]> {
  const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const matches = PRODUCTS.filter((p) => {
    const text = [p.title, p.description, ...p.tags].join(" ").toLowerCase();
    return words.every((w) => text.includes(w));
  });
  return sorted(matches, sortKey, reverse);
}

// ── the cookie cart ──────────────────────────────────────────────────────

type Lines = Map<string, number>;

/** Parse the cookie's value: `[[variantId, quantity], …]`. Anything that is
 *  not a known variant with a sane quantity is dropped, so a tampered or
 *  stale cookie (a catalogue that changed under it) degrades to fewer lines,
 *  never an error. */
export function parseLines(raw: string | undefined): Lines {
  const lines: Lines = new Map();
  if (!raw) return lines;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return lines;
  }
  if (!Array.isArray(parsed)) return lines;
  for (const entry of parsed.slice(0, MAX_LINES)) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [id, qty] = entry;
    if (typeof id !== "string" || !variants.has(id)) continue;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) continue;
    lines.set(id, Math.min(qty, MAX_QUANTITY));
  }
  return lines;
}

export function serializeLines(lines: Lines): string {
  return JSON.stringify([...lines.entries()]);
}

/** The Cart lib/shopify's types describe, priced from the catalogue. */
export function toCart(lines: Lines): Cart {
  const items: CartItem[] = [];
  let total = 0;
  for (const [id, quantity] of lines) {
    const hit = variants.get(id);
    if (!hit) continue;
    const { product, variant } = hit;
    const amount = Number(variant.price.amount) * quantity;
    total += amount;
    items.push({
      id,
      quantity,
      cost: {
        totalAmount: {
          amount: amount.toFixed(2),
          currencyCode: variant.price.currencyCode,
        },
      },
      merchandise: {
        id: variant.id,
        title: variant.title,
        selectedOptions: variant.selectedOptions,
        product: {
          id: product.id,
          handle: product.handle,
          title: product.title,
          featuredImage: product.featuredImage,
        },
      },
    });
  }
  const currencyCode = items[0]?.cost.totalAmount.currencyCode ?? "USD";
  return {
    id: DEMO_CART_COOKIE,
    checkoutUrl: DEMO_CHECKOUT_URL,
    cost: {
      subtotalAmount: { amount: total.toFixed(2), currencyCode },
      totalAmount: { amount: total.toFixed(2), currencyCode },
      totalTaxAmount: { amount: "0.00", currencyCode },
    },
    lines: items,
    totalQuantity: items.reduce((n, i) => n + i.quantity, 0),
  };
}

async function readLines(): Promise<Lines> {
  return parseLines((await cookies()).get(DEMO_CART_COOKIE)?.value);
}

async function writeLines(lines: Lines): Promise<Cart> {
  (await cookies()).set(DEMO_CART_COOKIE, serializeLines(lines), {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
  });
  return toCart(lines);
}

export async function createCart(): Promise<Cart> {
  return toCart(await readLines());
}

// Always a cart, never undefined: the cart modal creates one through a
// server action whenever it finds none, and the demo has nothing to create.
export async function getCart(): Promise<Cart> {
  return toCart(await readLines());
}

export async function addToCart(
  lines: { merchandiseId: string; quantity: number }[],
): Promise<Cart> {
  const current = await readLines();
  for (const { merchandiseId, quantity } of lines) {
    if (!variants.has(merchandiseId)) {
      throw new Error(`Unknown product variant: ${merchandiseId}`);
    }
    if (!variants.get(merchandiseId)!.variant.availableForSale) {
      throw new Error(`Out of stock: ${merchandiseId}`);
    }
    const next = (current.get(merchandiseId) ?? 0) + quantity;
    if (next > 0) current.set(merchandiseId, Math.min(next, MAX_QUANTITY));
  }
  return writeLines(current);
}

export async function removeFromCart(lineIds: string[]): Promise<Cart> {
  const current = await readLines();
  for (const id of lineIds) current.delete(id);
  return writeLines(current);
}

export async function updateCart(
  lines: { id: string; merchandiseId: string; quantity: number }[],
): Promise<Cart> {
  const current = await readLines();
  for (const { id, quantity } of lines) {
    if (!current.has(id)) continue;
    if (quantity <= 0) current.delete(id);
    else current.set(id, Math.min(quantity, MAX_QUANTITY));
  }
  return writeLines(current);
}

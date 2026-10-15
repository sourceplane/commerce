# apps/web — the storefront

Vercel's open-source Next.js storefront template (MIT, `license.md`) on
Cloudflare Workers + Static Assets: server components over a store API, a
server-action cart with optimistic updates, `"use cache"` data revalidated by
tag. The template's pages and components are kept; what this app adds is the
Workers build, the cache bindings, a demo catalogue for a store that is not
connected yet, and a cart page and a checkout notice.

- `app/` — the routes: home, `/search`, `/search/[collection]`,
  `/product/[handle]`, `/cart`, `/checkout`, `/[page]`, the Open Graph images,
  `robots.txt`, `sitemap.xml`, and `/api/revalidate` (Shopify's webhooks)
- `app/site.ts` — the store's name, the repository its footer links to, and
  the request origin every absolute URL is built on
- `lib/shopify/` — the Storefront API client; each exported reader and cart
  operation answers from `lib/demo` instead while no store is connected
  (`SHOPIFY_STORE_DOMAIN` unset)
- `lib/demo/` — the bundled catalogue (`catalogue.ts`) and a cookie cart;
  its images are `public/demo/*.svg`
- `components/` — cart (server actions, optimistic context, modal), navbar,
  grid, product gallery, the demo banner

```bash
pnpm dev        # next dev on http://localhost:3000
pnpm build      # next build + opennextjs-cloudflare build → .open-next/
pnpm preview    # wrangler dev over the built Worker: a local R2 bucket, local Durable Objects
```

The cache's bucket is not hand-written. `wrangler.template.jsonc` names it as
a wiring token; `wrangler.jsonc` is that template rendered from
`wiring.fixture.json` (placeholder names, for local work and verification),
and every deploy renders it again from the name the `cloudflare-r2` Terraform
root published for the environment (`component.yaml`'s `buildCommand`).

## Store backend

| `SHOPIFY_STORE_DOMAIN` | catalogue, menus, pages | cart | checkout |
|---|---|---|---|
| unset (a fresh deploy) | `lib/demo`, never cached | the `demo-cart` cookie, priced from the catalogue | `/checkout`: "Connect a payment provider to enable checkout" |
| set | the Storefront API, cached in R2 (`"use cache"`), revalidated by webhook | a Shopify cart (`cartId` cookie) | Shopify's hosted checkout |

Connecting a store is three Worker secrets and Shopify's webhooks — the
repository's README, "Connecting Shopify".

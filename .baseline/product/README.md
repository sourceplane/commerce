# commerce

A headless storefront — home, search, collections, product pages and a cart —
on **Cloudflare Workers + Static Assets** through
[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare), built from
Vercel's open-source Next.js storefront template (MIT, `apps/web/license.md`).
The Next.js data cache lives in an **R2 bucket** that Terraform provisions per
environment, and its tag cache and revalidation queue in **Durable Objects**
the Worker itself exports.

It is live from its first deploy with no third-party key: until you connect a
Shopify store it serves a **bundled demo catalogue** (six sample products, two
collections, menus and pages) and keeps the cart in a cookie, and checkout
says plainly that a payment provider must be connected first.

## Live deployment

<!-- 02-docs:begin -->
Not recorded yet. The bootstrap's last phase writes the live URLs, the
workspace and the secrets inventory into
[ai/context/deployment.md](ai/context/deployment.md); how the store deploys
and how to operate it is in
[ai/context/operations.md](ai/context/operations.md).
<!-- 02-docs:end -->

## What is here

| Surface | Where |
|---|---|
| Home, `/search`, `/search/[collection]`, `/product/[handle]`, `/cart`, `/checkout`, `/[page]`, OG images, sitemap, robots | `apps/web/app` |
| The store's name and source link | `apps/web/app/site.ts` |
| The Shopify client (`"use cache"` readers, cart mutations, the webhook's `revalidate`) — and the switch to the demo when no store is connected | `apps/web/lib/shopify` |
| The demo catalogue and the cookie cart | `apps/web/lib/demo`, images in `apps/web/public/demo` |
| Cart (server actions, optimistic context, modal), navbar, grid, product gallery | `apps/web/components` |
| Workers build, cache bindings and deploy contract | `apps/web/next.config.ts`, `open-next.config.ts`, `wrangler.template.jsonc` + `wiring.fixture.json` (→ `wrangler.jsonc`), `component.yaml` |
| The R2 bucket (stage, prod) | `infra/terraform/cloudflare-r2` |
| Tests | `tests/web` (vitest) |

## Getting started

```bash
pnpm install
pnpm run wire:fixture   # render apps/web/wrangler.jsonc from the offline fixture
pnpm typecheck
pnpm lint
pnpm test
pnpm build              # next build + opennextjs-cloudflare build → apps/web/.open-next
```

```bash
pnpm --filter @app/web dev        # http://localhost:3000, Next's dev server
pnpm --filter @app/web preview    # wrangler dev over the built Worker, a local R2 bucket and local Durable Objects
```

With no Shopify facts in the environment both serve the demo catalogue. Make
the store yours in `apps/web/app/site.ts` (its name and the repository the
footer links to); the demo's products are `apps/web/lib/demo/catalogue.ts`.

## Connecting Shopify

The storefront reads one store through the Shopify Storefront API. Shopify is
not a provider the platform brokers, so you connect it yourself, once, after
the store is live:

1. **In Shopify**, create a Storefront API access token (Settings → Apps and
   sales channels → Develop apps, or the Headless channel), and set up what
   the storefront reads by handle: the menus `next-js-frontend-header-menu`
   and `next-js-frontend-footer-menu`, and the collections
   `hidden-homepage-featured-items` (the home page's three-item grid) and
   `hidden-homepage-carousel` (its carousel). Collections whose handle starts
   with `hidden` never appear in search; products tagged
   `nextjs-frontend-hidden` are left out of listings.
2. **Give each environment's Worker the store's three facts** as Worker
   secrets. The deploy lane never sets or clears them, so this is once:

   ```bash
   cd apps/web
   for env in stage prod; do
     wrangler secret put SHOPIFY_STORE_DOMAIN            --name commerce-web-$env   # your-store.myshopify.com
     wrangler secret put SHOPIFY_STOREFRONT_ACCESS_TOKEN --name commerce-web-$env
     wrangler secret put SHOPIFY_REVALIDATION_SECRET     --name commerce-web-$env   # any long random string
   done
   ```

   Setting a secret publishes a new version of the Worker; its next request
   reads the store. The demo banner goes, the catalogue, menus, pages and cart
   are Shopify's, and nothing is rebuilt. Demo answers were never cached, so
   none outlives the switch.
3. **Register Shopify's webhooks** (Settings → Notifications → Webhooks) for
   `products/create`, `products/update`, `products/delete`,
   `collections/create`, `collections/update` and `collections/delete`,
   pointing at
   `https://commerce-web-prod.your-workers-subdomain.workers.dev/api/revalidate?secret=<SHOPIFY_REVALIDATION_SECRET>`
   (and the stage URL, if stage has a store of its own). Each delivery
   revalidates the `products` or `collections` tag in the Durable Object tag
   cache; the next request re-renders from Shopify.

Product images then come from `cdn.shopify.com`, which `next.config.ts`
already allows. To use another store backend instead, replace the functions
`lib/shopify/index.ts` exports — `lib/demo` is a complete second
implementation of the same surface to copy from.

## Checkout and payments

The storefront never takes payment itself. With Shopify connected, "Proceed to
Checkout" sends the shopper to the cart's Shopify-hosted checkout, which takes
payment through whichever payment provider the Shopify store has enabled
(Shopify Payments or another, in the Shopify admin under Settings →
Payments). Without a store there is no payment provider: `/checkout` answers
with a notice — "Connect a payment provider to enable checkout" — the cart is
kept on the shopper's device, and nothing is charged.

## How the cache is wired

The Worker binds the bucket as `NEXT_INC_CACHE_R2_BUCKET` (every `"use cache"`
entry and pre-rendered page), and two Durable Objects: `NEXT_TAG_CACHE_DO_SHARDED`
(which tags were revalidated, and when) and `NEXT_CACHE_DO_QUEUE` (background
revalidation of stale routes, through the Worker's own
`WORKER_SELF_REFERENCE` binding). The bucket's name is never hand-written:
`apps/web/wrangler.template.jsonc` names it as a wiring token, and
`wrangler.jsonc` is that template rendered — from `wiring.fixture.json` for
local work and verification, and on every deploy from the document the
`cloudflare-r2` Terraform root publishes after its apply
(`WIRING_CLOUDFLARE_R2`, per environment). Edit the template, then
`pnpm run wire:fixture`; Checks fails if the committed `wrangler.jsonc` is not
the fixture render. The Durable Objects need no root: the migration in the
config creates them on the first deploy.

## How it deploys

Merges to `main` converge through [Orun](https://github.com/sourceplane/orun):
`.github/workflows/ci.yml` plans the changed components and runs each lane
against the workspace in `intent.yaml`. The R2 bucket applies first, then the
storefront builds with that environment's bucket name and deploys — to
`stage`, then to `prod` once stage has converged on the same commit; `dev`
only verifies. The Worker is `commerce-web-<env>` on your account's
workers.dev subdomain, and every deploy is smoke-tested over HTTP: the home
page must answer, and `robots.txt` must name the origin it was asked on, which
only the Worker renders. `checks.yml` runs install, the fixture render,
typecheck, lint, test and build on every pull request. (A push to `main` runs
`ci.yml` alone, which applies, builds and deploys.)

The pipeline holds one credential, GitHub's own `GITHUB_TOKEN`. The Cloudflare
tokens and account id are brokered per run from the workspace's Cloudflare
connection — one to deploy the Worker, one with R2 access for the bucket's
apply — and the bucket names travel as Orun secrets; nothing provider-shaped
is stored in the repository or in GitHub. Shopify's facts are Worker secrets,
set once on the Workers themselves.

## How it maps to Vercel

| Vercel | Here |
|---|---|
| Next.js hosting (SSR, server actions, route handlers, `next/og`) | One Cloudflare Worker (`.open-next/worker.js`) + Static Assets (`ASSETS`) |
| Data Cache: `"use cache"` entries with `cacheLife("days")` | The R2 bucket bound as `NEXT_INC_CACHE_R2_BUCKET`, written at request time |
| Tag revalidation from the Shopify webhook, `updateTag` from cart actions | A sharded Durable Object tag cache consulted on every cache read |
| Stale-while-revalidate (ISR) | A Durable Object queue that re-renders stale routes through the Worker |
| `VERCEL_PROJECT_PRODUCTION_URL` | Nothing: absolute URLs are built on the request's origin (`app/site.ts`) |
| Shopify integration env vars | Worker secrets (above); the demo catalogue until they are set |
| Deploy on push | Orun applies the bucket and deploys `commerce-web-{stage,prod}` on merge to `main` (`apps/web/component.yaml`) |

Partial prerendering is off: `@opennextjs/cloudflare` 1.20 cannot run Next 16's
Cache Components on workerd yet, so the storefront keeps the template's
`"use cache"` directives through `experimental.useCache` and renders every
route at request time.

## Custom domain

The store answers on workers.dev from its first deploy. To serve it on your
own domain, add the domain to the Cloudflare account the store deploys into
and attach it to the Worker (dashboard → Workers & Pages →
`commerce-web-prod` → Settings → Domains & Routes → Add → Custom domain), and
point Shopify's webhooks at it. The store builds its absolute links from the
request it is answering, so nothing else has to change; the repository names
the domain in one place, `BASE_DOMAIN` in `intent.yaml` (one line per
environment), which the store was born with as the reserved placeholder
`commerce.example.com`. Replace it with your domain in the same change that
records it.

# commerce

Vercel's [Next.js Commerce](https://github.com/vercel/commerce) — the Shopify
headless storefront: server components over the Storefront API, a
server-action cart, `"use cache"` data revalidated from Shopify webhooks —
running on **Cloudflare Workers + Static Assets** through
[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare), with the
Next.js data cache in an **R2 bucket** provisioned by Terraform through
[Orun](https://github.com/sourceplane/orun) and the tag cache and revalidation
queue in **Durable Objects** the Worker itself exports, inside the repository
conventions of the [Cirrus baseline](https://github.com/sourceplane/cirrus-baseline).

The template's code is the code. What the port adds is the Workers build, the
cache bindings, the monorepo wrapper, a test package for the Shopify client
and the webhook, the R2 Terraform root, and the deploy contract that threads
the bucket into the Worker per environment. See
[`specs/epics/commerce`](specs/epics/commerce/README.md) for the design, the
milestones and the as-built status.

## What is here

| Surface | Where |
|---|---|
| Home, `/search`, `/search/[collection]`, `/product/[handle]`, `/[page]`, OG images, sitemap, robots | `apps/web/app` |
| The Shopify client (`"use cache"` readers, cart mutations, the webhook's `revalidate`) | `apps/web/lib/shopify` |
| Cart (server actions, optimistic context, modal), navbar, grid, product gallery | `apps/web/components` |
| Workers build, cache bindings and deploy contract | `apps/web/next.config.ts`, `apps/web/open-next.config.ts`, `apps/web/wrangler.template.jsonc`, `apps/web/component.yaml` |
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

To run against a Shopify store, put its facts in `apps/web/.env.local` for
Next's dev server (see `apps/web/.env.example`) and in `apps/web/.dev.vars`
for the Worker preview (see `apps/web/.dev.vars.example`), then:

```bash
pnpm --filter @app/web dev        # http://localhost:3000, Next's dev server
pnpm --filter @app/web preview    # wrangler dev over the built Worker, with a local R2 bucket and local Durable Objects
```

Without a store the storefront renders its un-configured state (no products,
no menus), exactly as upstream does before its Shopify integration is
connected; `/search`, `/[page]` and `/sitemap.xml` surface upstream's error
for a missing store.

## How it maps to Vercel

| Vercel | Here |
|---|---|
| Next.js hosting (SSR, server actions, route handlers, `next/og`) | One Cloudflare Worker (`.open-next/worker.js`) + Static Assets (`ASSETS`) |
| Data Cache: `"use cache"` entries with `cacheLife("days")` | The R2 bucket bound as `NEXT_INC_CACHE_R2_BUCKET`, written at request time |
| Tag revalidation: `revalidateTag` from the Shopify webhook, `updateTag` from cart actions | A sharded Durable Object tag cache (`NEXT_TAG_CACHE_DO_SHARDED`) consulted on every cache read |
| Stale-while-revalidate (ISR) | A Durable Object queue (`NEXT_CACHE_DO_QUEUE`) that re-renders stale routes through the Worker's `WORKER_SELF_REFERENCE` binding |
| `next/image` over `cdn.shopify.com` | The Worker's own `/_next/image`: validated against `remotePatterns`, served unoptimised (no `IMAGES` binding; Shopify's CDN already sizes) |
| Project env vars in the dashboard | `COMPANY_NAME`, `SITE_NAME`, `SITE_URL` as wrangler `vars`; `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_ACCESS_TOKEN`, `SHOPIFY_REVALIDATION_SECRET` as Worker secrets |
| `VERCEL_PROJECT_PRODUCTION_URL` | The `SITE_URL` var (metadata base, robots, sitemap) |
| Deploy on push | Orun deploys `commerce-web-{stage,prod}` on merge to `main` (`apps/web/component.yaml`) |

Partial prerendering is off: `@opennextjs/cloudflare` 1.20 cannot run Next
16's Cache Components on workerd yet, so the storefront keeps upstream's
`"use cache"` directives through `experimental.useCache` and renders every
route at request time — which is what upstream's root-layout cart promise
made it do anyway.

## Connecting Shopify

Follow Vercel's [Shopify integration guide](https://vercel.com/docs/integrations/ecommerce/shopify)
for the store side — a Headless (Storefront API) access token, the
`next-js-frontend-header-menu` and `next-js-frontend-footer-menu` menus, the
`hidden-homepage-featured-items` and `hidden-homepage-carousel` collections —
then give each environment's Worker the three facts as secrets (once; the
deploy lane does not set them):

```bash
cd apps/web
for env in stage prod; do
  wrangler secret put SHOPIFY_STORE_DOMAIN            --name commerce-web-$env   # your-store.myshopify.com
  wrangler secret put SHOPIFY_STOREFRONT_ACCESS_TOKEN --name commerce-web-$env
  wrangler secret put SHOPIFY_REVALIDATION_SECRET     --name commerce-web-$env   # any long random string
done
```

Then register a webhook in Shopify (Settings → Notifications → Webhooks) for
`products/create`, `products/update`, `products/delete`,
`collections/create`, `collections/update` and `collections/delete`, pointing
at `https://commerce-web-prod.<subdomain>.workers.dev/api/revalidate?secret=<SHOPIFY_REVALIDATION_SECRET>`.
Each delivery revalidates the `products` or `collections` tag in the Durable
Object tag cache; the next request re-renders from Shopify. Set `SITE_URL`
in `apps/web/wrangler.template.jsonc` to the public origin once you know it.

## Deploying

`.github/workflows/checks.yml` runs install, wire, typecheck, lint, test and
build on every push and pull request. `ci.yml` is the Orun pipeline: set
`execution.state.workspace` in `intent.yaml` to this product's workspace
(`orun cloud link`), connect Cloudflare to that workspace, and set the
`ORUN_CI` repository variable to `true`. A merge to `main` then applies the
R2 root, renders `wrangler.jsonc` from its wiring document, builds the app
and deploys the Worker to `stage`, then `prod`; the Durable Objects are
created by the migration in the wrangler config on the first deploy.

The first deploy serves everything on demand: the build pre-renders only
`/robots.txt`, `/favicon.ico` and `/opengraph-image`, every storefront route
is dynamic, and every `"use cache"` entry is written to R2 by the first
request that needs it. Uploading the build's pre-rendered output to the
bucket is therefore optional —

```bash
pnpm --filter @app/web exec opennextjs-cloudflare populateCache remote   # needs CLOUDFLARE_API_TOKEN / account, and wrangler.jsonc rendered for the target environment
```

— and not recommended from a `Checks` build, whose `"use cache"` results are
the un-configured store's empty menus and collections.

# commerce — design

## 1. What the template is

Next.js App Router, React Server Components, server actions. `lib/shopify`
talks to Shopify's Storefront GraphQL API (`/api/2023-01/graphql.json`)
with `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_STOREFRONT_ACCESS_TOKEN`: readers
for menus, collections, products, pages and the cart; mutations for the
cart. The readers are `"use cache"` functions tagged `collections` /
`products` with `cacheLife("days")`; the cart reader is
`"use cache: private"` (per cookie, `cacheLife("seconds")`). Cart actions
(`components/cart/actions.ts`) mutate through Shopify and `updateTag("cart")`.
`app/api/revalidate` is Shopify's webhook target: it checks
`?secret=` against `SHOPIFY_REVALIDATION_SECRET`, reads `x-shopify-topic`,
and `revalidateTag`s `products` or `collections` — always answering HTTP 200
(Shopify retries anything else). Pages: home (featured grid + carousel),
`/search` and `/search/[collection]` with sort, `/product/[handle]` with
gallery and variant selector, `/[page]` for Shopify pages, OG images with
`next/og`, a dynamic sitemap, robots. Tailwind 4, Geist, Headless UI,
sonner. `experimental.ppr`, `useCache` and `inlineCss` on a Next 15.6 canary.

## 2. The mapping (Vercel → Cloudflare)

| Vercel primitive the template uses | Here |
|---|---|
| Next.js hosting: SSR, server actions, route handlers (`/api/revalidate`, sitemap, robots), `next/og` image routes | Cloudflare Workers + Static Assets; the Worker is `@opennextjs/cloudflare`'s output, assets bound as `ASSETS`; `next/og` renders in the Worker, its font read through `ASSETS` |
| Data Cache: `"use cache"` entries (`cacheLife("days")`), `"use cache: private"` for the cart | The R2 incremental cache (`NEXT_INC_CACHE_R2_BUCKET`), written at request time; the private cache stays in-request |
| Tag revalidation: `revalidateTag(tag, "seconds")` from the webhook, `updateTag` from cart actions | The sharded Durable Object tag cache (`NEXT_TAG_CACHE_DO_SHARDED`, `baseShardSize: 12`): tag → last revalidation time, checked on every cache read |
| ISR / stale-while-revalidate of cached routes | The Durable Object queue (`NEXT_CACHE_DO_QUEUE`): deduplicated re-renders requested from the Worker itself through `WORKER_SELF_REFERENCE` |
| Partial prerendering (`experimental.ppr`) | Off. Next 16 merges `ppr` into `cacheComponents`, whose staged rendering the adapter cannot run on workerd yet (risk CM-A); `experimental.useCache` keeps the directives. Every storefront route renders at request time — as upstream's did, the root layout's cart promise having left no route a static shell |
| `next/image` with `remotePatterns` for `cdn.shopify.com` | Unchanged config; the Worker's own `/_next/image` validates the URL and serves the CDN image unoptimised (no `IMAGES` binding) |
| Project env vars in the Vercel dashboard | `COMPANY_NAME`, `SITE_NAME`, `SITE_URL` as wrangler `vars` in the template; `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_ACCESS_TOKEN`, `SHOPIFY_REVALIDATION_SECRET` as Worker secrets, set once per environment |
| `VERCEL_PROJECT_PRODUCTION_URL` (metadata base, robots, sitemap) | `SITE_URL` |
| Cron | None upstream; none here |
| Deploy on push | Orun: `apps/web/component.yaml` (`cloudflare-workers-assets-turbo`) deploys `commerce-web-{stage,prod}` on merge to `main` once the product is linked |

## 3. The cache architecture

```
                 request                      Shopify webhook
                    │                               │ POST /api/revalidate?secret=…
                    ▼                               ▼
   ┌────────────────────────────────────────────────────────────┐
   │ Worker commerce-web-<env>  (.open-next/worker.js)          │
   │   Next server ── "use cache" reader ──► composable cache   │
   │        │                                     │   │         │
   │        │ revalidateTag / updateTag            │   │ get/set │
   │        ▼                                     ▼   ▼         │
   │   exports: DOQueueHandler, DOShardedTagCache                │
   └──────┬───────────────────┬──────────────────────┬──────────┘
          │ NEXT_TAG_CACHE_   │ NEXT_CACHE_DO_QUEUE  │ NEXT_INC_CACHE_R2_BUCKET
          │ DO_SHARDED        │                      │
          ▼                   ▼                      ▼
   Durable Object        Durable Object         R2 bucket (per env,
   tag → revalidated-at  stale-route queue      infra/terraform/cloudflare-r2)
   (12 shards)           → WORKER_SELF_REFERENCE  incremental-cache/<buildId>/*.composable
                           re-renders the route
```

A cache read fetches the entry from R2 and asks the tag cache whether any of
its tags was revalidated after the entry was written; if so the entry is
stale and the reader runs again. The webhook writes the tag; cart actions
write `cart`. Nothing is pre-populated: the build's prerender cache holds
only `/robots.txt`, `/favicon.ico`, `/opengraph-image` and `/_global-error`,
all of which the Worker renders on a miss, so `populateCache remote` is an
optional, documented command rather than a deploy step (risk CM-C).

## 4. The env and wiring flow

```
infra/terraform/cloudflare-r2  ──apply──►  orun secrets (commerce/<env> rung)
   outputs: r2_bucket_name, wiring            WIRING_CLOUDFLARE_R2
                                                    │
apps/web/component.yaml secretEnv ◄─────────────────┘
   WIRING_CLOUDFLARE_R2_<ENV>  → tooling/wire/live.mjs --env $ORUN_ENVIRONMENT
                               → wrangler.jsonc: r2_buckets[].bucket_name,
                                 name + services[].service = commerce-web-<env>

Worker secrets (once per environment, by hand — the product's one manual step):
   wrangler secret put SHOPIFY_STORE_DOMAIN / SHOPIFY_STOREFRONT_ACCESS_TOKEN /
                       SHOPIFY_REVALIDATION_SECRET --name commerce-web-<env>
```

`wrangler.template.jsonc` carries the `@@wiring(cloudflare-r2/__ENV__:r2_bucket_name)@@`
token and `__ENV__` in the Worker's name and self-reference. The verify lane
(and `pnpm run wire:fixture`) renders it from `wiring.fixture.json`; the
deploy lane renders it from the live document for `$ORUN_ENVIRONMENT`. The
rendered `wrangler.jsonc` is git-ignored. The storefront reads every value
through `process.env`, exactly as it does on Vercel; locally `.dev.vars`
(git-ignored) carries the three secrets for `wrangler dev`.

## 5. The repository

```
apps/web                      the template (app/, components/, lib/, public/fonts) + the Workers build
  component.yaml              depends on cloudflare-r2; renders wrangler then builds with turbo; deploys with wrangler; smokes /
  wrangler.template.jsonc     name commerce-web-__ENV__, nodejs_compat, ASSETS, vars, R2 binding (wiring token),
                              the two Durable Object bindings + migration, WORKER_SELF_REFERENCE
  wiring.fixture.json         offline bucket names for the verify lane
  open-next.config.ts         r2IncrementalCache + doQueue + doShardedTagCache({ baseShardSize: 12 })
  next.config.ts              upstream's images config; experimental.useCache + inlineCss; standalone output; initOpenNextCloudflareForDev
  cloudflare-env.d.ts         the ASSETS binding's type (what `wrangler types` would generate)
  .dev.vars.example           the three Shopify secrets for the local preview
infra/terraform/cloudflare-r2 the bucket per environment (factory root): name + wiring document as orun secrets
tests/web                     vitest: lib/utils, lib/type-guards, lib/shopify with a mocked fetch, the webhook's revalidate
tooling/*                     shared tsconfig / eslint / wrangler wiring renderer
```

## 6. The build

`pnpm --filter @app/web build` = `next build` (standalone output, traced
from the monorepo root; `experimental.useCache`) then
`opennextjs-cloudflare build --skipBuild`, which emits `.open-next/worker.js`
(exporting the two Durable Object classes), the server bundle and
`.open-next/assets/`. No `populateCache` step: nothing the storefront serves
is pre-rendered (§3). Locally, `pnpm --filter @app/web preview` runs the same
output under `wrangler dev` with a local bucket and local Durable Objects.

## 7. Out of scope

Cloudflare Images for `next/image` (an `images` binding away), a custom
domain (the baseline's `cloudflare-domain` root), Shopify's customer
accounts and checkout customisation (the template hands off to Shopify's
checkout URL), the alternative commerce providers upstream lists, and
automating the Worker secrets from orun secrets (open in risk CM-B).

## 8. Alternatives rejected

**D1 tag cache.** OpenNext's other tag cache is a D1 table (`d1NextTagCache`)
with a `next-cache` schema that must be created and, for ISR, populated at
deploy with `populateCache`. It would add a Terraform root, a migration lane
and a deploy-time write for a table whose only job is tag → timestamp. The
sharded Durable Object needs nothing but a class the Worker already exports
and a migration line in the wrangler config, is strongly consistent, and
spreads a hot tag over `baseShardSize` objects.

**KV incremental cache.** `kvIncrementalCache` is simpler to provision than
R2 but eventually consistent: a webhook revalidation followed by a read on
another edge could serve the entry the revalidation was meant to replace.
R2 reads are strongly consistent, the bucket is the factory's existing root,
and Workers' R2 access is in-region.

**Static-assets incremental cache.** What the content-site ports use. It is
read-only: nothing written at request time persists, which defeats
`"use cache"` and `revalidateTag`. Right for a blog, wrong for a store.

**`cacheComponents: true`.** The faithful spelling of upstream's
`experimental.ppr` + `useCache` on Next 16, and the port tried it first: the
build needed three small upstream edits (a sitemap `connection()`, a cached
footer year, `instant = false`) and the Worker then hung on every request
(risk CM-A). `experimental.useCache` keeps the directives and the upstream
files verbatim; `cacheComponents` is the one-line upgrade once the adapter
runs staged renders.

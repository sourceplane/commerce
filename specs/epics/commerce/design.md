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
rendered `wrangler.jsonc` is committed as the fixture render (CM4: the deploy
lane's `verify-app-structure` checks it exists before it builds — risk CM-J)
and re-rendered by every lane's build; `dev`, which no root applies to,
renders the fixture (CM-K). The storefront reads the Shopify facts through
`process.env`, exactly as it does on Vercel; locally `.dev.vars` (git-ignored)
carries them for `wrangler dev`. Unset, the storefront serves its demo
catalogue (§9).

## 5. The repository

```
apps/web                      the template (app/, components/, lib/, public/fonts) + the Workers build
  app/site.ts                 the store's name and source link (CM4: the rename seam) + the request origin
  app/cart, app/checkout      the cart as a page; checkout's "connect a payment provider" notice (CM4)
  lib/demo, public/demo       the bundled demo catalogue and cookie cart, served while no store is connected (CM4)
  component.yaml              depends on cloudflare-r2 (enforced on main); renders wrangler then builds with turbo;
                              deploys with wrangler; smokes / and the Worker-rendered robots.txt
  wrangler.template.jsonc     name commerce-web-__ENV__, nodejs_compat, ASSETS, R2 binding (wiring token),
                              the two Durable Object bindings + migration, WORKER_SELF_REFERENCE
  wiring.fixture.json         offline bucket names for local work and the verify lanes (dev, stage, prod)
  wrangler.jsonc              the fixture render, committed (CM4)
  open-next.config.ts         r2IncrementalCache + doQueue + doShardedTagCache({ baseShardSize: 12 })
  next.config.ts              upstream's images config; experimental.useCache + inlineCss; standalone output; initOpenNextCloudflareForDev
  cloudflare-env.d.ts         the ASSETS binding's type (what `wrangler types` would generate)
  .env.example                the optional Shopify facts, for .env.local (next dev) or .dev.vars (the preview)
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

## 9. The baseline (CM4)

The repository instantiates new storefronts the way
[cirrus-baseline](https://github.com/sourceplane/cirrus-baseline) does since
its one-landing bootstrap (`baseline-v22`): a console card (`blueprint.yaml`)
the platform renders, a build document (`repo-blueprint.yaml`) `orun new`
runs, and a rename engine that makes the copy somebody else's. What a small
product carries besides — the product README, the context pack, the
deployment-record hook, the bootstrap helpers and the offline test suite —
is `portfolio-starter-kit`'s `baseline-v2`, ported from `kv-redis-starter`'s
conversion (its sibling on the same conventions).

| | kv-redis-starter | cirrus-baseline (`baseline-v22`) | here |
|---|---|---|---|
| phases | `01-product`, `02-docs` | `01-product`, `07-domain` (optional), `08-docs` | `01-product`, `02-docs` |
| the order a landing used to hold | the KV namespace before the Worker | the data plane before the fleet | the R2 bucket before the Worker that binds it |
| how the plan holds it instead | enforced `dependsOn` on main, advisory on a PR | the same, plus `policy-worker`'s placeholders | `apps/web` `dependsOn: cloudflare-r2`, `mode: enforced` with `modeRules` advisory on `github-pull-request` |
| brokered secrets | `CLOUDFLARE_API_TOKEN` (`workers-deploy`), `CLOUDFLARE_ACCOUNT_ID` | + `CLOUDFLARE_D1_TOKEN` (`d1-edit`) | + `CLOUDFLARE_R2_TOKEN` (`r2-data`): `workers-deploy` carries no R2 |
| the landing's await | watch, `WIRING_CLOUDFLARE_KV`, probe | watch, `WIRING_CLOUDFLARE_D1`/`_KV`, probe | watch, `WIRING_CLOUDFLARE_R2` on stage and prod, probe |
| a third party | none | none | Shopify — not brokered: a demo catalogue until the owner adds Worker secrets |
| stack-tectonic | 0.19.0 | 0.20.0 | 0.19.0 (Next 16's Turbopack refuses 0.20.0's lane-scoped install) |

**One landing.** `01-product` places every module, brands the tree, and
lands it as one pull request whose checks it waits for. The convergence after
the merge plans `cloudflare-r2` (apply) and `web` (deploy) on stage and prod;
each web lane is one level below its environment's R2 lane, so the Worker
deploy starts after the apply — and since a job resolves its secrets when it
starts, the `WIRING_CLOUDFLARE_R2_<ENV>` its build renders from is there.
Stage and prod run side by side (the promotion gate is deferred until
`02-docs`), and dev's push lanes are deferred too. The landing then waits on
the convergence, asks the platform that the wiring exists on both
environments, and probes both URLs. `02-docs` places nothing: it restores the
two deferrals, renders the deployment record and lands it.

**Two Cloudflare keys.** The R2 root lists the account's buckets at plan time
(`adopt.tf`) and creates one at apply; `workers-deploy` grants Workers Scripts
and KV and no R2, so the root binds `CLOUDFLARE_API_TOKEN` to
`CLOUDFLARE_R2_TOKEN`, minted from `r2-data` by a second reconcile hook — the
shape a D1 root has with `d1-edit`. The card's `spec.secrets` mirrors the
three hooks and `testing/manifest.test.sh` holds them together.

**No third-party key on a fresh build.** Rule 8 of the baseline brief: a
third party the platform does not broker cannot be a precondition of going
live. Every function `lib/shopify` exports is a switch: with
`SHOPIFY_STORE_DOMAIN` set it is upstream's cached Storefront API reader
(renamed `shopify*`, unchanged); unset it answers from `lib/demo` — six
products with variants (one sold out, so the template's out-of-stock state
shows), two collections plus the two `hidden-homepage-*` ones the home page
reads, both menus, two pages, SVG images in `public/demo` — and the cart is
a cookie of variant ids and quantities, priced from the catalogue on every
read. The switch sits OUTSIDE the `"use cache"` functions: a cache entry is
keyed by its arguments, not by which backend answered, so a cached demo
answer would outlive the moment the owner connects Shopify. Checkout without
a store lands on `/checkout`, which answers 200 with "Connect a payment
provider to enable checkout"; with a store, `/checkout` forwards to the
cart's Shopify checkout. A banner on every page says the store is a demo. A
`/cart` page renders the cart on the server (the modal is client-only), and
is where the e2e reads what the server action added.

**Identity in the app** is `apps/web/app/site.ts`: `SITE_NAME` (navbar,
footer, every `<title>`, the Open Graph image, the logo's label — which read
`process.env.SITE_NAME`) and `SOURCE_URL` (the footer's source link, which
pointed at upstream's repository — a URL containing this baseline's slug).
**This baseline's slug is an English word**, and the repo-slug rule renames
every standalone `commerce`; its capitalised form, `Commerce`, is the pascal
residue the sweep fails on. So no shipped file spells either outside an
identity form — prose says "store" or "storefront", the upstream is credited
as "Vercel's open-source Next.js storefront template" — and
`testing/leak.test.sh` gates it.

**No `SITE_URL`.** `metadataBase`, `robots.txt` and the sitemap are built on
the request's own origin (`requestOrigin`), which is right on workers.dev, on
a custom domain and under `wrangler dev` with nothing to configure; the smoke
uses it as its proof that the Worker rendered the response.

**Testing without the platform.** `testing/lib/bootstrap.sh` places both
phases and runs the blueprint's own `run:` hooks; `testing/placement.test.sh`
plans the product's own merge (the R2 apply first, with its own key) and a
pull request (nothing waits); `testing/e2e.test.sh` builds the product in the
tree orun stages with the stage wiring document in the job's environment,
dry-deploys it, serves it, and browses it as a shopper: a product, its
options, Add To Cart through the build's own server action, the cart, and
checkout's notice.

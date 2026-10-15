# commerce

Vercel's [Next.js Commerce](https://github.com/vercel/commerce) — the headless
storefront: server components over a store API, a server-action cart,
`"use cache"` data revalidated from Shopify webhooks — running on **Cloudflare
Workers + Static Assets** through
[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare), with the
Next.js data cache in an **R2 bucket** provisioned by Terraform through
[Orun](https://github.com/sourceplane/orun) and the tag cache and revalidation
queue in **Durable Objects** the Worker itself exports — and packaged as an
**Orun baseline**: one command takes a new storefront from nothing to live on
stage and prod, in its own repository, under its own name, in ONE landing.

A fresh build needs no third-party key: until its owner connects a Shopify
store, the storefront serves a **bundled demo catalogue** (six products, two
collections, menus, pages) with a cookie cart, and checkout answers with a
"connect a payment provider" notice rather than an error. See
[`specs/epics/commerce`](specs/epics/commerce/README.md) for the design, the
milestones and the as-built status.

## Instantiating a product

```bash
git clone --depth 1 --branch <baseline-tag> https://github.com/sourceplane/commerce
cd commerce
orun new --blueprint repo-blueprint.yaml --out ~/sites/acme-shop --run-hooks --resume \
  --set reponame=acme-shop --set productname="Acme Shop" --set productdomain=shop.acme.dev \
  --set githuborg=acme-inc --set subdomain=<workers-dev-subdomain>
```

Or, once the platform's registry lists it, from the Orun console (Baselines →
`commerce` → Build). Two phases: **`01-product`** creates the repository and
lands the whole product as ONE pull request — intent, CI, tooling, the R2
root, the storefront and its tests — and one convergence applies the R2
bucket on stage and prod and then deploys the storefront bound to it;
**`02-docs`** records the live deployment from probed facts.
**[BOOTSTRAP.md](BOOTSTRAP.md)** is the operator guide;
[docs/phases/](docs/phases/README.md) has a page per phase.

The new repository receives the **product only** — the app, its R2 root, its
tests, its CI, its tooling, a README of its own and its operating contract —
renamed throughout to the product's name, repository, Cloudflare Worker and
bucket names. None of this repository's machinery ships. Its owner then
connects Shopify with three Worker secrets (the product's README, "Connecting
Shopify"); the card asks for no Shopify key, because the platform does not
broker one.

| What makes it a baseline | Where |
|---|---|
| The console card (inputs, secrets, programme) | `blueprint.yaml` |
| The build document (modules, phases, hooks) | `repo-blueprint.yaml` |
| This tree's identity, and the bootstrap's task contracts | `.baseline/` |
| The rename engine | `tooling/rebrand/rebrand.mjs` |
| The bootstrap's helpers (deferrals, redeploy marker, work-tree strip) | `tooling/bootstrap/` |
| The deployment-record renderer | `hooks/render-deployment-docs.sh` |
| The product's README and context pack | `.baseline/product/README.md`, `ai/context/` |
| The baseline's tests: contract, wiring, leak, offline bootstrap, end to end | `testing/`, `.github/workflows/baseline.yml` |
| Cutting a `baseline-vN` tag | `.github/workflows/tag.yml` |

## What is here (the product)

| Surface | Where |
|---|---|
| Home, `/search`, `/search/[collection]`, `/product/[handle]`, `/cart`, `/checkout`, `/[page]`, OG images, sitemap, robots | `apps/web/app` |
| The store's name and source link | `apps/web/app/site.ts` |
| The Shopify client (`"use cache"` readers, cart mutations, the webhook's `revalidate`) and the demo switch | `apps/web/lib/shopify` |
| The demo catalogue and the cookie cart | `apps/web/lib/demo`, `apps/web/public/demo` |
| Cart (server actions, optimistic context, modal), navbar, grid, product gallery | `apps/web/components` |
| Workers build, cache bindings and deploy contract | `apps/web/next.config.ts`, `open-next.config.ts`, `wrangler.template.jsonc` + `wiring.fixture.json` (→ the committed `wrangler.jsonc`), `component.yaml` |
| The R2 bucket (stage, prod) | `infra/terraform/cloudflare-r2` |
| The wrangler renderer | `tooling/wire` |
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

Without Shopify facts in the environment both serve the demo catalogue. To
run against a store, put its facts in `apps/web/.env.local` for Next's dev
server and in `apps/web/.dev.vars` for the Worker preview (both from
`apps/web/.env.example`).

## How it maps to Vercel

| Vercel | Here |
|---|---|
| Next.js hosting (SSR, server actions, route handlers, `next/og`) | One Cloudflare Worker (`.open-next/worker.js`) + Static Assets (`ASSETS`) |
| Data Cache: `"use cache"` entries with `cacheLife("days")` | The R2 bucket bound as `NEXT_INC_CACHE_R2_BUCKET`, written at request time |
| Tag revalidation: `revalidateTag` from the Shopify webhook, `updateTag` from cart actions | A sharded Durable Object tag cache (`NEXT_TAG_CACHE_DO_SHARDED`) consulted on every cache read |
| Stale-while-revalidate (ISR) | A Durable Object queue (`NEXT_CACHE_DO_QUEUE`) that re-renders stale routes through the Worker's `WORKER_SELF_REFERENCE` binding |
| `next/image` over `cdn.shopify.com` | The Worker's own `/_next/image`, validated against `remotePatterns`, served unoptimised; the demo's SVGs are static assets |
| The Shopify integration's env vars | `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_ACCESS_TOKEN`, `SHOPIFY_REVALIDATION_SECRET` as Worker secrets — and, unset, the bundled demo catalogue instead of an empty store |
| `VERCEL_PROJECT_PRODUCTION_URL` | Nothing: metadata, robots and the sitemap are built on the request's origin (`app/site.ts`) |
| Deploy on push | Orun applies the bucket and deploys `<repo>-web-{stage,prod}` on merge to `main` (`apps/web/component.yaml`) |
| "Deploy with Vercel" (clone the template) | `orun new --blueprint repo-blueprint.yaml` — a new repository, branded, deployed |

Partial prerendering is off: `@opennextjs/cloudflare` 1.20 cannot run Next 16's
Cache Components on workerd yet, so the storefront keeps upstream's
`"use cache"` directives through `experimental.useCache` and renders every
route at request time.

## How the bucket reaches the Worker

```
infra/terraform/cloudflare-r2 ──apply (r2-data token)──► orun secret WIRING_CLOUDFLARE_R2 (stage, prod)
                                               │   (the landing's await checks it exists)
                                               ▼
apps/web  dependsOn cloudflare-r2 (enforced on main) · secretEnv WIRING_CLOUDFLARE_R2_<ENV>
  build:  tooling/wire/live.mjs → wrangler.jsonc with the environment's bucket name
          (dev, verify-only, renders the fixture) → next build → opennextjs-cloudflare
  deploy: workers-deploy token → <repo>-web-<env>, its Durable Objects migrated on first deploy
```

`wrangler.jsonc` is committed as the fixture render of
`wrangler.template.jsonc`, because the deploy lane's `verify-app-structure`
step checks the config exists before it builds; Checks fails if the two
disagree.

## CI

| Workflow | What it runs | Ships to a product |
|---|---|---|
| `checks.yml` | install, wire fixtures (and the committed config is their render), typecheck, lint, test, build — every PR (not pushes: on main, `ci.yml` must be the only run a commit has, because the bootstrap's convergence watch takes the newest one) | yes |
| `ci.yml` | the Orun pipeline: `orun plan --changed`, then one job per lane; applies the R2 bucket, then deploys stage → prod on merge. It plans nothing while `intent.yaml` names the placeholder workspace `ws_CHANGE_ME`, as this repository does | yes |
| `baseline.yml` | the baseline's own tiers: contract tests, the wiring path, the blueprint read by the pinned orun, the leak gate, the offline bootstrap with the product's own plan, the product built in the job tree, dry-deployed, served, browsed and added to the cart | no |
| `tag.yml` | cuts a `baseline-vN` tag (manual) | no |

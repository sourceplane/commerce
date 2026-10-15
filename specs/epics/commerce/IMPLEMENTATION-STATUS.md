# commerce (CM) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md` or from the upstream template.

| Milestone | State | PR |
|---|---|---|
| CM0 — the spec | ✅ Shipped | [#1](https://github.com/sourceplane/commerce/pull/1) |
| CM1 — the storefront on Workers | ✅ Shipped | [#2](https://github.com/sourceplane/commerce/pull/2) |
| CM2 — the cache infrastructure from Terraform | ✅ Shipped (validated; apply gated on a linked workspace) | [#3](https://github.com/sourceplane/commerce/pull/3) |
| CM3 — ready to instantiate | ✅ Shipped | [#4](https://github.com/sourceplane/commerce/pull/4) |

## Departures from the upstream template

Upstream is [vercel/commerce](https://github.com/vercel/commerce) at
`3761e52` (2026-06-10). `app/`, `components/` and `lib/` are byte-identical
to it except for the four files named below.

### `next.config.ts`: `experimental.useCache`, not `experimental.ppr` + `useCache`

Upstream enables `experimental.ppr`, `useCache` and `inlineCss` on a Next
15.6 canary. Next 16.3.8 (the adapter's floor) hard-deprecates
`experimental.ppr` into `cacheComponents`, and a Worker built with
`cacheComponents: true` hangs on every request under `@opennextjs/cloudflare`
1.20.11 (Cache Components' staged render ends each stage on workerd's
microtask `process.nextTick`; opennextjs-cloudflare#1450, fix PR #1318
unmerged). `experimental.useCache: true` (deprecated in 16, a warning)
enables the same `"use cache"` / `"use cache: private"` / `cacheTag` /
`cacheLife` / `revalidateTag` / `updateTag` surface through OpenNext's
composable cache; `inlineCss` is kept. Partial prerendering is off: every
storefront route is dynamic. Upstream's root layout starts the cart's
private-cache promise outside any Suspense boundary, so no route had a
static shell there either. The port first tried `cacheComponents` — it
built, after a sitemap `connection()`, a cached footer year and
`instant = false`, and then hung — and reverted those three files to
upstream verbatim.

### `lib/shopify/index.ts`: stable `cacheLife` / `cacheTag` imports

`unstable_cacheLife as cacheLife, unstable_cacheTag as cacheTag` →
`cacheLife, cacheTag`. Next 16 logs an error on every call through the
`unstable_` names and will remove them.

### `lib/utils.ts`: `baseUrl` honours `SITE_URL`

`metadataBase`, robots and the sitemap are built on `baseUrl`, which
upstream derives from Vercel's `VERCEL_PROJECT_PRODUCTION_URL`. On
Cloudflare that is the `SITE_URL` wrangler var; the Vercel variable and the
`http://localhost:3000` default are kept behind it.

### `components/opengraph-image.tsx`: the font through `ASSETS`

Upstream reads `fonts/Inter-Bold.ttf` with `fs` from `process.cwd()`. A
Worker has no filesystem (`/bundle/fonts/…` does not exist). The font moved
to `public/fonts/Inter-Bold.ttf`; `loadFont()` reads it from disk first
(`next dev`, `next build`, Vercel) and, when that fails, through the
`ASSETS` binding via `getCloudflareContext({ async: true })`.
`cloudflare-env.d.ts` declares the binding's type (what `wrangler types`
would generate). `/opengraph-image` answers a 1200×630 PNG from the Worker.

### `tsconfig.json`: `moduleResolution: bundler`

Upstream's `node` resolution cannot see `@opennextjs/cloudflare`'s subpath
exports (`/config`, `/overrides/*`), which `open-next.config.ts` imports.

### Around the template

- `react` / `react-dom` ^19.2.1 (upstream 19.0.0): Next 16's peer range.
- An ESLint flat config over the workspace's shared config (upstream ships
  none), with `caughtErrors: "none"` for the template's `catch (e)` server
  actions. Lint is warnings-only (`console.log` guards, `any` in actions).
- Upstream's `test` script is `prettier --check`, which upstream's own HEAD
  fails on two files (prettier 3 trailing commas in
  `components/cart/actions.ts` and `lib/shopify/index.ts`). Both are kept
  byte-identical; the `prettier` / `prettier:check` scripts remain but the
  workspace `test` is `tests/web`.
- `.env.example` gains `SITE_URL` and a note on where each value lives;
  `.dev.vars.example` lists the three Worker secrets.
- `tooling/migrations` (a `packages/db` checksum checker the skeleton
  carries for Supabase ports) is not in this repository: no database.

### Versions

| Package | Version | Why |
|---|---|---|
| next | 16.3.8 | newest inside `@opennextjs/cloudflare` 1.20.11's peer range; 16.4 fails at Worker boot |
| @opennextjs/cloudflare | ^1.20.11 | R2 incremental cache, DO queue, DO sharded tag cache; `next/og` on the Worker |
| wrangler | ^4.151.0 | compatibility_date 2026-10-01; SQLite Durable Object migrations |
| react, react-dom | ^19.2.1 | Next 16 peer range (upstream 19.0.0) |
| typescript, tailwindcss, @tailwindcss/postcss, prettier | upstream's pins | unchanged |

## Verified

- Local: `pnpm run wire:fixture`, `pnpm typecheck`, `pnpm lint` (warnings
  only), `pnpm test` (22 tests), `pnpm build` green on Node 25;
  `terraform validate` green on `infra/terraform/cloudflare-r2`.
- `wrangler dev` over `.open-next/worker.js` with the fixture config, an
  empty local bucket, local Durable Objects and no store: `/` 200 (the
  un-configured storefront, "Next.js Commerce"), `/search` and
  `/search?q=…` 200, `/product/<unknown>` 404, `/robots.txt` 200,
  `/opengraph-image` 200 (PNG 1200×630), `/favicon.ico` and the CSS chunk
  200, `/sitemap.xml` and `/<page>` 500 (upstream's unguarded
  `validateEnvironmentVariables` / `getPage`); `"use cache"` entries appear
  in the bucket (`incremental-cache/<buildId>/*.composable`) after the first
  request; `DOQueueHandler` and `DOShardedTagCache` namespaces exist.
- `POST /api/revalidate`: without a secret or with a wrong one, body
  `{"status":401}` with HTTP 200 (upstream's Shopify-retry rule). With dummy
  secrets in `.dev.vars` (a non-resolving `.invalid` store domain, never
  committed): `products/update` and `collections/create` →
  `{"status":200,"revalidated":true}` with Durable Object storage writes and
  R2 puts observed; `orders/create` → `{"status":200}`;
  `/product/<handle>` 500 (the unreachable store, as upstream).
- CI: `Checks` green on #2 and #3 (install, wire, typecheck, lint, test,
  build on Node 22).
- Not verified: an apply of the R2 root, a live deploy, and the storefront
  against a real Shopify store (no store was contacted) — all need the
  product linked to an Orun workspace with a Cloudflare connection
  (`ORUN_CI` variable) and the three Worker secrets set (README).

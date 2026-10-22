# commerce (CM) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md` or from the upstream template.

| Milestone | State | PR |
|---|---|---|
| CM0 — the spec | ✅ Shipped | [#1](https://github.com/sourceplane/commerce/pull/1) |
| CM1 — the storefront on Workers | ✅ Shipped | [#2](https://github.com/sourceplane/commerce/pull/2) |
| CM2 — the cache infrastructure from Terraform | ✅ Shipped (validated; apply gated on a linked workspace) | [#3](https://github.com/sourceplane/commerce/pull/3) |
| CM3 — ready to instantiate | ✅ Shipped | [#4](https://github.com/sourceplane/commerce/pull/4) |
| CM4 — a baseline, in one landing | ✅ Shipped (offline-proven; no live bootstrap yet, risk CM-P) | [#5](https://github.com/sourceplane/commerce/pull/5) (CM-5), tagged `baseline-v1` |
| CM5 — the cirrus standard | ✅ Shipped | [#6](https://github.com/sourceplane/commerce/pull/6) (CM-6), [#7](https://github.com/sourceplane/commerce/pull/7) (CM-7), tagged `baseline-v2` |
| CM6 — the domain is set later | ✅ Shipped | [#8](https://github.com/sourceplane/commerce/pull/8) (CM-8), tagged `baseline-v3` |

## Departures from the upstream template

Upstream is [vercel/commerce](https://github.com/vercel/commerce) at
`3761e52` (2026-06-10). Through CM3, `app/`, `components/` and `lib/` were
byte-identical to it except for the four files named below; CM4's changes
follow them, under "Departures from the port (CM4)".

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
`http://localhost:3000` default are kept behind it. (Through CM3. CM4
removed `SITE_URL` and `baseUrl`: every absolute URL is built on the
request's own origin — "Identity, origin and the baseline's wiring" below.)

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
- `apps/web/.env.example` lists the optional values — `COMPANY_NAME` and the
  three Shopify secrets — and where each lives (`.env.local` for `next dev`,
  `.dev.vars` for the preview, Worker secrets when deployed). Through CM3 it
  also carried `SITE_URL`, and a separate `.dev.vars.example` listed the
  secrets; CM4 removed the one and folded in the other (below).
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

## Departures from the port (CM4)

### A storefront with no store: the demo catalogue

| What | Before | After | Why |
|---|---|---|---|
| `lib/shopify/index.ts` | each reader `"use cache"`d, guarded by "Shopify not configured" → empty (some unguarded → 500) | each export a switch: `isShopifyConfigured()` → the upstream reader (renamed `shopify*`, body unchanged, formatted) or `lib/demo`; `isShopifyConfigured` exported | a fresh build must render with no third-party key (risk CM-N); the switch is outside `"use cache"` so no demo answer outlives a connected store |
| `lib/demo/` | — | the catalogue (6 products, variants, one sold out; 4 collections incl. the two `hidden-homepage-*`; 2 menus; 2 pages) and a cookie cart priced from it | the same |
| `public/demo/*.svg` | — | seven product images, served as static assets (next/image leaves SVGs unoptimised) | no third-party image host |
| `app/cart/page.tsx` | — (the cart was the client-only modal) | the cart rendered on the server; checkout is a plain form post to `redirectToCheckout` | "cart" as a route that renders without JavaScript |
| `app/checkout/page.tsx` | — | Shopify connected: forwards to the cart's checkout; else 200, "Connect a payment provider to enable checkout" | checkout without a payment provider is a notice, not a 500 |
| `components/cart/actions.ts` `redirectToCheckout` | `redirect(cart!.checkoutUrl)` | `redirect(cart?.checkoutUrl \|\| "/checkout")` | a missing cart threw |
| `components/demo-banner.tsx`, `app/layout.tsx` | — | a banner on every page while no store is connected | the demo says it is one |
| `components/welcome-toast.tsx` | "Welcome to Next.js Commerce", "Deploy your own" → vercel.com | the store's name; the source link | identity, and the demo mention |
| `app/[page]/opengraph-image.tsx`, `app/search/[collection]/opengraph-image.tsx` | `params.page` read synchronously | `await params` | Next 16 passes image-route params as a Promise; every such image was a 500 |
| `components/opengraph-image.tsx` | a missing title rendered blank | falls back to the store's name | an image for a page that does not exist yet |

### Identity, origin and the baseline's wiring

| What | Before | After | Why |
|---|---|---|---|
| the store's name | `SITE_NAME` wrangler var read through `process.env` (navbar, footer, layout, logo, OG image) | `SITE_NAME` in `app/site.ts` | the rename seam; any name the card admits stays a valid string |
| the source link | footer: github.com/vercel/… and "Deploy" → vercel.com/templates/…, "Created by ▲ Vercel" | `SOURCE_URL` in `app/site.ts`; "Runs on Cloudflare Workers" | upstream URLs contain the slug, which the rename would rewrite (risk CM-O) |
| `SITE_URL`, `baseUrl` | wrangler var → `metadataBase`, robots, sitemap | removed; `requestOrigin(headers)` | no configured origin; workers.dev, a custom domain and `wrangler dev` all right |
| `app/sitemap.ts` | `validateEnvironmentVariables()` → 500 without a store | removed from the sitemap | the sitemap lists the demo catalogue too |
| wrangler `vars` | `COMPANY_NAME`, `SITE_NAME`, `SITE_URL` | none (`COMPANY_NAME` optional, documented) | the seam and the request origin replace them |
| `apps/web/wrangler.jsonc` | git-ignored, rendered by the build | committed as the fixture render, GENERATED banner; Checks diffs it | risk CM-J |
| dev's render | `live.mjs --env dev` → no document → red | `--fixture wiring.fixture.json --fixture-envs dev`; the fixture has a `dev` entry | risk CM-K |
| `apps/web` → `cloudflare-r2` | `dependsOn` in the default mode | `mode: enforced`, `modeRules` advisory on `github-pull-request` | the one landing's order on main; a PR deploys nothing |
| the R2 root's token | `CLOUDFLARE_API_TOKEN` (`workers-deploy`: no R2) | `CLOUDFLARE_R2_TOKEN` (`r2-data`), bound as the provider's `CLOUDFLARE_API_TOKEN` | risk CM-L |
| `apps/web` smoke | `grep 'Next.js Commerce'` on `/` | `/` answers and `/robots.txt` names the origin it was asked on | the name is the owner's; robots.txt proves the Worker rendered it, whatever the backend |
| `ci.yml` gate | `vars.ORUN_CI == 'true'` | skip only while `intent.yaml` names `ws_CHANGE_ME` | a bootstrap cannot set a repository variable |
| `checks.yml` | push to main + PRs | PRs + `workflow_dispatch` | `orun.run/watch@v1` takes the newest run on the merge sha from ANY workflow |
| stack-tectonic | 0.18.2 | 0.19.0 | first-deploy retry and smoke backoff; not 0.20.0 (Next 16's Turbopack) |
| orun lane pin | v2.78.0 | v2.78.4 | the sibling baselines' pin |
| `packages/` | absent — `orun plan` failed on the discovery root | `packages/.gitkeep` | the discovery roots are required |
| `intent.yaml` docs pages | `specs/epics/…` | `ai/context/*` | the pages must exist in a product |
| `apps/web/.dev.vars.example` | the three Shopify secrets | folded into `.env.example` | the blueprint's `ignore` drops `**/.dev.vars.*`, so it could not ship |
| `apps/web/README.md` | upstream's (Deploy with Vercel, provider list) | the app's, crediting the upstream by description | it ships, and its URLs spell the slug (CM-O) |
| `tasks/CM-1..4` | no `metadata` | `metadata.name` and `title` | `orun work check` (≥ v2.79) refused them |

## The cirrus standard (CM5)

Nothing about the storefront changed. What changed is the baseline around it:

| What | Before | After | Why |
|---|---|---|---|
| orun pin | `kiox.yaml` (v2.15.0) + `kiox.lock`, shipped to every storefront | gone; orun is pinned where it runs, the `orun-action` `version:` in each workflow | nothing ran the kiox pin, and it disagreed with the lanes (v2.78.4) |
| `root-kiox`, `root-kiox-lock` modules | in `01-product` | removed (`testing/phases.test.sh` and the rebrand's skip list follow) | a storefront is placed with 147 files (140 − 2 + 9): no kiox, plus the docs below |
| component docs | none | `apps/web/docs/`, `infra/terraform/cloudflare-r2/docs/`, `tests/web/docs/` — `overview.md`, `architecture.md`, `runbook.md` | cirrus-baseline documents every component; the workspace Docs library renders `docs/` beside each `component.yaml` |
| how the docs stay true | — | `tooling/catalog/gen-component-docs.py` derives them from the manifest, the Worker config, Terraform, migrations and package scripts; Baseline CI runs it with `--check` | a hand-written copy of a manifest drifts silently |
| context pack | `operations.md`, `deployment.md` | plus `current.md`, `decisions.md`, `open-risks.md` | cirrus-baseline's shape; the three new pages are this repository's own and no module places them (the leak gate still allows exactly two) |
| status | CM4 "this PR, to be tagged"; risk CM-B and design §2/§7 describing CM3's wrangler vars and calling CM-B open; the epic README's gate claiming an offline `plan` | CM4 shipped ([#5](https://github.com/sourceplane/commerce/pull/5)) and tagged `baseline-v1`; CM-B, design §2/§7 and "Around the template" say what CM4 built (no vars, request origin, `.env.example` only); the gate says offline is `validate` only | the documents had not caught up with the tag and with CM4 |

### The subdomain from the Cloudflare connection (CM-7)

`subdomain` was the one input an operator typed that the platform could
answer itself: it belongs to the Cloudflare account the same way its id does,
and it has exactly one right answer. A typed one could only be wrong, and
wrong showed up after deploy — in the deploy's smoke (its `DEPLOYED_URL`), the
phase probes and the console's verify URLs. `blueprint.yaml` now declares
`from: connection.cloudflare.workersSubdomain`, as cirrus-baseline does since
baseline-v23: the Cloudflare integration reads the subdomain at connect and on
its hourly health check, and the bootstrap door fills the input from the
connection the build is bound to — the same one `CLOUDFLARE_ACCOUNT_ID` and the
deploy tokens mint from. The console renders no field for it, and an account
with no workers.dev subdomain is refused at the door with the fix named.

- `testing/manifest.test.sh` takes cirrus-baseline's rule verbatim: the source
  is accepted, and only when `spec.requires.integrations` lists its provider.
- `repo-blueprint.yaml` keeps the input and its default; it, `BOOTSTRAP.md`
  and `docs/phases/README.md` say only a hand-run build passes
  `--set subdomain`.
- Nothing a storefront carries changes: the rename writes the value where it
  always did (`workersDevSubdomain`, the URLs), and the probes read it as
  before.

Verified:

- `testing/{manifest,phases,coverage,rebrand,retouch,bootstrap-defer,wire}.test.sh`
  green; `gen-component-docs.py --check` green (3 components).
- Mutation: with `cloudflare` dropped from `spec.requires.integrations`,
  `manifest.test.sh` fails with exactly one finding, naming
  `inputs[subdomain]`; restored, it passes.
- `orun new --status` at v2.58.11: `01-product` pending, 147 files.
  `testing/leak.test.sh` at v2.58.11: 147 files derived; 140 shipped sources
  name no factory path. `testing/placement.test.sh` at v2.78.4: 147 files
  placed, two landings; the product's own plan applies `cloudflare-r2` at
  level 0 and deploys `web` at level 1 on stage and prod; the 02-docs merge
  plans 0 jobs; `--resume` a no-op.
- `orun task check CM-7` complete.

## The domain is set later (CM6, CM-8)

The console asked for the store's domain, with help text that said it did not
need to exist — and nothing in the build needed one: the store answers on
workers.dev from its first deploy, builds its absolute links (canonical,
sitemap, robots, Open Graph) from the request it is answering, and the smoke
and the phase probes read workers.dev. The one place the repository names the
domain is `BASE_DOMAIN` in `intent.yaml` (one line per environment: dev,
stage, prod). A domain is an owner's step after the bootstrap (README,
"Custom domain"), so the form no longer asks for it.

- `blueprint.yaml` declares no `productdomain` input; the console asks for
  the store's name alone.
- `repo-blueprint.yaml`'s `productdomain` is optional, default empty. Nothing
  else in the build reads it — no hook, probe or `when:` — so an empty value
  is harmless; `.rebrand/values.json` records `""`. A hand-run build may still
  pass `--set productdomain=` for a store that already has its domain.
- `rebrand.mjs` no longer requires it. Empty, it brands the reserved
  placeholder `<reponame>.example.com` (RFC 2606 — never someone else's
  domain) where the domain goes, so setting it later is replacing one
  string; the product README and `ai/context/operations.md` say so (the
  README's "nothing in the repository changes" now names that one string).
- `testing/fixtures/acme.json` carries no domain, so the leak gate, the
  offline bootstrap and the e2e tier exercise exactly what a console build
  supplies. Its slug, `acme-commerce`, makes the placeholder
  `acme-commerce.example.com`, which ENDS in the baseline's own
  `commerce.example.com`; `testing/rebrand.test.sh` pins that it survives
  three passes, beside the placeholder for an absent and an empty domain.
  `baseline.yml`'s blueprint read sets no domain.

Nothing that needs a domain was removed — it waits for one.

Verified:

- `testing/{manifest,phases,coverage,rebrand,retouch,bootstrap-defer,wire}.test.sh`
  green (rebrand: with the previous `rebrand.mjs` the three new checks fail;
  restored, they pass); `gen-component-docs.py --check` green (3 components).
- At v2.58.11 (the blueprint job's pin): `orun new --status` with no
  `productdomain` reads the document (`01-product` pending, 147 files);
  `testing/leak.test.sh` 147 files derived; 140 shipped sources name no
  factory path.
- At v2.78.4 (the placement pin): `testing/placement.test.sh` 147 files
  placed, two landings; the store's own plan applies `cloudflare-r2` at
  level 0 and deploys `web` at level 1 on stage and prod; the 02-docs merge
  plans 0 jobs; `--resume` a no-op.
- The offline bootstrap of the fixture leaves `.rebrand/values.json`
  `productdomain` empty and `BASE_DOMAIN: acme-commerce.example.com` in all
  three environments of the store's `intent.yaml` (and the same string in its
  README and `operations.md`); no line names `commerce.example.com` on its
  own.
- `orun task check CM-8` complete.

## Verified (CM5)

- `testing/{manifest,phases,coverage,rebrand,retouch,bootstrap-defer,wire}.test.sh`
  green; `gen-component-docs.py --check` green (3 components, 9 pages).
- `testing/leak.test.sh` at v2.58.11 (the blueprint job's pin): 147 files
  derived (140 − 2 kiox + 9 docs pages); `ai/context` still exactly the two
  declared pages; 140 shipped sources name no factory path, the generated
  pages included, and none spells the slug outside an identity form.
- `testing/placement.test.sh` at v2.78.4 (the lane pin, as `baseline.yml`
  runs it — CM-Q): 147 files placed, two landings, branded and re-tenanted;
  the product's own push-to-main plan applies `cloudflare-r2` (the `r2-data`
  key) at level 0 and deploys `web` at level 1 on stage and prod; on a pull
  request nothing waits; the 02-docs merge plans 0 jobs; `--resume` a no-op.
- The Checks sequence: `pnpm install --frozen-lockfile`, `wire:fixture` (no
  diff), typecheck, lint (0 errors, 6 warnings), test (6 files, 33 tests),
  build green.
- `testing/e2e.test.sh` at v2.78.4 green: the stage lane's four steps in the
  staged job tree, the bucket bound from the stage document; `wrangler dev`
  serves the demo storefront with no Shopify key — a product added to the
  cart twice through the build's own server action, `/cart`, and checkout's
  "Connect a payment provider".
- `orun task check CM-6` complete.

## Verified (CM4)

- `orun new --status` reads the blueprint at v2.58.11 (the bootstrap floor),
  v2.78.4 (the lane pin) and v2.79.0: `01-product` 140 files, `02-docs`
  hook-only. `orun validate` and `orun work check` clean.
- `testing/{manifest,phases,coverage,rebrand,retouch,bootstrap-defer,wire}.test.sh`
  green — the card's three secrets (`CLOUDFLARE_API_TOKEN`/`workers-deploy`,
  `CLOUDFLARE_R2_TOKEN`/`r2-data`, `CLOUDFLARE_ACCOUNT_ID`/`account-id`)
  against the reconcile hooks; the rename's 34 cases, the two slug hazards
  among them.
- `testing/leak.test.sh` (v2.58.11 and v2.79.0): 140 files derived; nothing
  of the factory, nothing local or built, no provenance prose; 133 shipped
  sources name no factory path, and none spells the slug outside an identity
  form.
- `testing/placement.test.sh` (v2.78.4 and v2.79.0; refused under v2.58.11 by
  design, risk CM-Q), fixture "Sam's Tees & Mugs" / `acme-inc/acme-commerce`
  — a slug that contains this baseline's: two landings; rebrand `--verify`
  clean; the store's name and source link, the Worker and its self-reference
  binding, the bucket names and every secret ref the product's; no file
  names a factory path; re-tenanted, `work:` stripped, promotion and dev
  lanes restored; record rendered. The product's own
  `orun plan --trigger github-push-main` for the 01-product merge:

  | job | profile | lane level | waits on | token |
  |---|---|---|---|---|
  | `cloudflare-r2.stage.terraform` | `terraform.apply` | 0 | — | `CLOUDFLARE_R2_TOKEN` |
  | `cloudflare-r2.prod.terraform` | `terraform.apply` | 0 | — | `CLOUDFLARE_R2_TOKEN` |
  | `web.stage.verify-deploy` | `cloudflare-workers-assets-turbo.deploy` | 1 | `cloudflare-r2.stage.terraform` | `CLOUDFLARE_API_TOKEN` |
  | `web.prod.verify-deploy` | `cloudflare-workers-assets-turbo.deploy` | 1 | `cloudflare-r2.prod.terraform` | `CLOUDFLARE_API_TOKEN` |

  On a pull request `web` waits on nothing; the 02-docs merge plans 0 jobs;
  `--resume` changes nothing.
- `testing/e2e.test.sh` (v2.78.4 and v2.79.0): the 01-product landing passes
  the Checks sequence (the committed config is the fixture render); in the
  job tree staged as orun stages it, the stage lane's `verify-app-structure`,
  `build-app` (the live render, from a stage document in the job's
  environment), `verify-build-output` and `deploy-dry-run` pass, binding
  `NEXT_INC_CACHE_R2_BUCKET` to the document's bucket beside the Durable
  Object and self-reference bindings; `wrangler dev` serves the built Worker
  (a local bucket, local Durable Objects, NO Shopify key); the component's
  own smoke passes; the home page carries the product's name, its source
  link, the demo banner and the demo catalogue; a shopper browses to the
  first featured product, picks its options, adds it to the cart twice
  through the build's own `addItem` server action, sees two on `/cart`,
  proceeds to checkout with the plain form post and lands on `/checkout`'s
  "Connect a payment provider to enable checkout" (200); search, a
  collection, a page, robots.txt and the sitemap on the asked origin, the Open
  Graph images, the demo's static assets and two 404s answer as promised.
- The repository's own Checks sequence (install, `wire:fixture` + `git diff
  --exit-code`, typecheck, lint, test — 6 files, 33 tests — build) green on
  Node 22.
- `terraform validate` green on `infra/terraform/cloudflare-r2` (1.15.3).
  The root's plan needs the Cloudflare API (`adopt.tf`), so offline it is
  held to `validate`.
- Not verified: a live bootstrap against a workspace — the tokens minted, the
  bucket applied, the Worker deployed with its R2 binding (risk CM-M), the
  probes — and the storefront against a real Shopify store (risk CM-P).

## Verified (CM1–CM3)

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

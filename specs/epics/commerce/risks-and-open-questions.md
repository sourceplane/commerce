# commerce — risks and open questions

## CM-A — Cache Components do not run on the adapter yet (RESOLVED, by not using them)

Upstream enables `experimental.ppr` and `experimental.useCache` on a Next
15.6 canary. Next 16 — the adapter's floor — merges both into
`cacheComponents`, and a Worker built with `cacheComponents: true` hangs on
every page under `@opennextjs/cloudflare` 1.20 (workerd runs
`process.nextTick` as a microtask, so Cache Components' staged render ends
each stage early: opennextjs-cloudflare#1450, fix in PR #1318, unmerged).
Decision: `experimental.useCache: true` alone, which Next 16 still accepts
(deprecated, a warning) and which enables exactly the `"use cache"` /
`"use cache: private"` / `cacheTag` / `cacheLife` / `revalidateTag` /
`updateTag` surface the storefront uses, served by OpenNext's composable
cache. Partial prerendering is off: every storefront route renders at
request time. That is what upstream did too — the root layout starts the
cart's `"use cache: private"` promise outside any Suspense boundary, so no
route had a static shell. When #1318 ships, `cacheComponents: true` is a
one-line change to try.

## CM-B — Where the Shopify facts live (RESOLVED)

`SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_ACCESS_TOKEN` and
`SHOPIFY_REVALIDATION_SECRET` are Worker secrets, set once per environment
with `wrangler secret put` (README). The store domain is not secret, but it
travels with the token: left unset, the storefront renders its un-configured
state (upstream's "Shopify not configured" guards), whereas a placeholder
domain in `vars` would make every page a 500. `COMPANY_NAME`, `SITE_NAME`
and `SITE_URL` are wrangler vars. The deploy lane does not set the secrets
(the `cloudflare-workers-assets-turbo` composition has no secret step): the
first deploy without them serves the un-configured storefront, and the
secrets take effect on the next request once set.

## CM-C — The prerender cache and `populateCache` (RESOLVED)

With the R2 incremental cache, pre-rendered output must be uploaded with
`opennextjs-cloudflare populateCache remote` to be served from the cache —
a step that needs Cloudflare credentials the Orun deploy lane cannot run
inside the workers-assets composition today. It does not matter here: the
build pre-renders only `/robots.txt`, `/favicon.ico`, `/opengraph-image` and
`/_global-error`; every storefront route is dynamic and every `"use cache"`
entry is written at request time. On a cache miss the Worker renders the
route (verified with an empty local bucket). `populateCache remote` stays a
documented optional command; running it would also upload the build's
`"use cache"` results, which in `Checks` are the un-configured store's
empty menus and collections — one more reason not to.

## CM-D — The font for `next/og` (RESOLVED)

`components/opengraph-image.tsx` reads `Inter-Bold.ttf` with `fs` — fine on
Vercel and during `next build`, impossible on a Worker (`/bundle/fonts/…`
does not exist). The font now lives under `public/fonts` and the component
reads it from disk first, then through the `ASSETS` binding
(`getCloudflareContext`). `/opengraph-image` answers a 1200×630 PNG from the
Worker; the per-page and per-collection OG images use the same path.

## CM-E — Images are unoptimised (ACCEPTED)

`next/image` with `remotePatterns` for `cdn.shopify.com` is kept. The
generated Worker serves `/_next/image` itself: it validates the URL against
the patterns and, with no `IMAGES` binding, returns the source image as
fetched from Shopify's CDN — which already serves sized, modern-format
variants. Cloudflare Images can be switched on later with an `images`
binding in the wrangler template; that is a cost decision, not a port
decision.

## CM-F — `revalidateTag` from the webhook races a read (ACCEPTED)

`revalidateTag(tag, "seconds")` writes the tag's revalidation time to the
sharded Durable Object tag cache (`baseShardSize: 12`); every cache read
checks its entry's tags against it, so a request arriving after the webhook
re-renders. Durable Objects are strongly consistent, which is why the tag
cache is not in KV (eventually consistent) and the incremental cache is in
R2 rather than KV. A request already rendering when the webhook lands may
still write a pre-webhook entry; the entry's `lastModified` is older than
the tag's revalidation time, so the next read discards it.

## CM-G — The self-reference and the Worker's name (RESOLVED)

The Durable Object queue revalidates a stale route by requesting it from
the Worker through the `WORKER_SELF_REFERENCE` service binding, which must
name the Worker exactly. The composition deploys `commerce-web-<env>`
(`workerName` + `environmentAwareWorkerName`), so the template's `name` and
the binding's `service` are both `commerce-web-__ENV__`, rendered per
environment; under `wrangler dev` the binding resolves to the dev Worker
itself (`[connected]`).

## CM-H — OpenNext and Next.js version drift (RISK, mitigated)

`next` is pinned to 16.3.8 (the newest inside `@opennextjs/cloudflare`
1.20.11's range; 16.4 fails at Worker boot). Bumping either is a deliberate
PR that re-runs the build and the `wrangler dev` smoke. The build prints
workerd warnings that `DOQueueHandler` / `DOShardedTagCache` are not
exported: they come from the miniflare `next.config.ts` starts for `next
dev` bindings, which is not the OpenNext Worker; the generated
`.open-next/worker.js` exports both.

## CM-I — Upstream's own prettier check (ACCEPTED)

Upstream's `test` script is `prettier --check`, and upstream's HEAD fails it
on two of its own files (prettier 3 trailing commas). The files are kept
byte-identical; `pnpm --filter @app/web prettier:check` still exists but is
not wired into the workspace `test`, which is `tests/web`.

## CM-J — The deploy lane checked for a config only the build makes (RESOLVED in CM4)

stack-tectonic's `cloudflare-workers-assets-turbo` runs `verify-app-structure`
— `test -f package.json`, `test -f <wranglerConfig>` — BEFORE `build-app`, in
a job tree staged from the checkout. `wrangler.jsonc` was git-ignored and
rendered only by the build, so every Orun lane of the product would have
failed at that step (no lane had ever run: `ORUN_CI` was never set). Fix:
commit `wrangler.jsonc` as the fixture render of `wrangler.template.jsonc`,
with a GENERATED banner; the build still re-renders it for its environment.
Checks fails when the two disagree (`git diff --exit-code` after
`wire:fixture`), and `testing/e2e.test.sh` runs the step in a staged tree.

## CM-K — The dev lane had no wiring document to render (RESOLVED in CM4)

`buildCommand` rendered with `live.mjs --env "${ORUN_ENVIRONMENT}"`, which
needs `WIRING_CLOUDFLARE_R2_<ENV>`; `dev` subscribes `web` but no root
applies there. Fix: `--fixture wiring.fixture.json --fixture-envs dev`, and a
`dev` entry in the fixture. stage and prod still refuse to render without the
real document (`testing/wire.test.sh`).

## CM-L — The R2 root authenticated with a token that carries no R2 (RESOLVED in CM4)

The root bound `CLOUDFLARE_API_TOKEN` to the project's `CLOUDFLARE_API_TOKEN`
— the `workers-deploy` key, which grants Workers Scripts, KV Storage and
Account Settings, and NO R2 (orun-cloud's `TEMPLATE_PERMISSION_GROUPS`). Its
plan (the `adopt.tf` bucket list) and apply would have been refused. Fix: a
second `orun.integrations/reconcile@v1` hook mints `CLOUDFLARE_R2_TOKEN` from
`r2-data` (Workers R2 Storage Write), and the root binds it as the
provider's `CLOUDFLARE_API_TOKEN`; the card's `spec.secrets` mirrors it.

## CM-M — Whether the Worker deploy needs R2 scope to bind a bucket (OPEN)

The deploy lane uploads a Worker whose config binds the bucket
(`r2_buckets`) with the `workers-deploy` token, which has no R2 permission.
Cloudflare validates that the bound bucket exists at upload; whether that
check needs the uploading token to hold R2 read is not documented, and no
offline test can tell. kv-redis-starter's deploy binds a KV namespace with
the same token, which does carry KV. If the first live bootstrap's deploy is
refused on the binding, the fix is to give the web component's deploy the
`r2-data` key too, or to widen `workers-deploy` in orun-cloud — not to drop
the binding. The registry row stays `unlisted` until a bootstrap answers it.

## CM-N — Shopify is a third party the platform does not broker (RESOLVED in CM4)

Upstream renders an empty store, and 500s on `/sitemap.xml`, `/[page]` and
every route that reaches an unguarded reader, until its Shopify integration
is connected. A baseline must go live with no key the platform cannot
broker. Fix: the demo catalogue (`lib/demo`) behind a per-request switch in
`lib/shopify`, outside the `"use cache"` functions (so no demo answer is
cached past the switch); a cookie cart; `/cart`; a `/checkout` that asks for
a payment provider; a demo banner. Connecting a store is three Worker
secrets and the webhooks, documented in the product's README. Demo answers
are never cached, which costs nothing (they are in memory).

## CM-O — This baseline's slug is an English word (ACCEPTED, gated)

The rename's repo-slug rule rewrites every standalone `commerce` in the
product tree, and its sweep fails on `Commerce` (the pascal form). Upstream's
own name ("Next.js Commerce"), its repository URL and every
`nextjs-commerce` link would therefore be rewritten into nonsense or fail
the rebrand. The shipped tree spells the word only in identity forms (the
Worker, bucket names, secret refs, the repo slug, the source link, the
`SITE_NAME` seam); prose says "store"/"storefront" and the upstream is
credited by description. `testing/leak.test.sh` refuses any other spelling in
a shipped source, and `testing/rebrand.test.sh` pins both hazards.

## CM-P — No live bootstrap yet (OPEN)

Everything short of the platform is proven on every pull request (the
IMPLEMENTATION-STATUS's CM4 "Verified"). NOT proven: the repository created
and linked, the two tokens minted, a real `terraform apply` (the root is held
to `terraform validate`; `adopt.tf` calls the Cloudflare API), the
lease-published document, a real `wrangler deploy` with the R2 and Durable
Object bindings (CM-M), the probes — and the storefront against a real
Shopify store, which nothing here contacts. Hence the registry row is
`unlisted` until one bootstrap from the tag has come up.

## CM-Q — The bootstrap floor plans every edge enforced (ACCEPTED)

orun v2.58.11 — the floor for RUNNING a bootstrap — does not apply a
`dependsOn` edge's `modeRules`: it plans a pull request with `web` waiting on
the R2 plan. That CLI never plans the product's CI (its `ci.yml` pins
v2.78.4), and on a push to main both agree. `baseline.yml` runs the placement
tier under the lane pin, and the test refuses an orun older than it.

## CM-R — A custom domain is the owner's step (ACCEPTED)

Attaching a domain to a Worker needs zone permissions the brokered
`workers-deploy` token does not carry. The product's README says how; nothing
in the repository changes, because the storefront takes its origin from the
request. Shopify's webhooks then point at the domain.

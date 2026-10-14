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

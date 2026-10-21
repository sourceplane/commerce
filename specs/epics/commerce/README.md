# Epic: commerce (CM)

**Vercel's Next.js Commerce is the template whose Vercel dependency is not a service but a cache. Its storefront is server components over Shopify's Storefront API, its cart a server action with an optimistic client, its data `"use cache"` entries tagged `products` and `collections` that a Shopify webhook revalidates — and on Vercel that cache and those tags live in the platform. The port keeps the code and gives the cache a home on Cloudflare: an R2 bucket for the entries, a sharded Durable Object for the tags, a Durable Object queue for stale re-renders, all bound to one OpenNext Worker that also exports the Durable Object classes; the bucket comes from Terraform through Orun, the Shopify facts from Worker secrets.**

The upstream code stays the code: `lib/shopify` (queries, mutations, reshaping, the webhook's `revalidate`), the cart actions and context, the pages, the OG images, the sitemap. The port adds the Workers build and the cache bindings, the monorepo wrapper, a test package that exercises the Shopify client and the webhook without a network, the R2 Terraform root, and the deploy contract that renders the bucket's name into the wrangler config per environment. Two things Next 16 and Workers force are recorded as departures: the `"use cache"` directives run through `experimental.useCache` rather than Cache Components (which the adapter cannot run yet), and the `next/og` font is read through the `ASSETS` binding.

## Status

| Field | Value |
|-------|-------|
| Status | ✅ Shipped — CM0–CM4 landed (#1–#5), tagged `baseline-v1`; CM5 (the cirrus standard, CM-6 #6 and CM-7 #7) tagged `baseline-v2`. R2 apply and live deploy proven only by a live bootstrap (risk CM-P) |
| Cluster | **CM** (CM0–CM5) |
| Owner(s) | `apps/web` (the storefront) · `tests/web` (client + webhook tests) · `infra/terraform/cloudflare-r2` (the cache bucket) |
| Builds on | `cirrus-baseline` conventions — intent, components, the Checks lane, the gated Orun lane; the factory's `cloudflare-r2` root and `tooling/wire` renderer |
| Upstream | [vercel/commerce](https://github.com/vercel/commerce) at `3761e52` (2026-06-10, "Use the Shopify integration in this template") |
| Changes | Adds the Workers build, the cache bindings, the monorepo wrapper, tests, the R2 root and the deploy contract; the storefront's code is untouched except where Next 16 or Workers force a change (status file) |
| Decisions locked | (1) OpenNext on Workers + Static Assets. (2) Incremental cache in R2, tag cache and queue in Durable Objects — no D1, no KV. (3) `wrangler.jsonc` is rendered per environment from the R2 root's wiring document — and, since CM4, committed as the fixture render, because the deploy lane checks it exists before the build (risk CM-J). (4) The Shopify facts are Worker secrets set once per environment; the deploy lane does not set them — and, since CM4, optional: without them the storefront serves a bundled demo catalogue (risk CM-N). (5) `experimental.useCache`, not `cacheComponents`, until the adapter runs staged renders. (6) CM4: one landing — the plan, not a landing boundary, orders the bucket before the Worker; the R2 root has its own `r2-data` key (risk CM-L). |
| Gate | CM1 is the first user-visible rung. CM2 needs a workspace with a Cloudflare connection to plan and apply (the root's plan lists the account's buckets, `adopt.tf`); offline it is held to `terraform validate`. |
| Shipped as | `baseline-v1` ([#5](https://github.com/sourceplane/commerce/pull/5)), then `baseline-v2` (CM5: [#6](https://github.com/sourceplane/commerce/pull/6), [#7](https://github.com/sourceplane/commerce/pull/7)); proven offline (Baseline CI), deploy gated until a workspace is linked |

## Read order

1. `design.md` — what maps to what, the cache architecture, the env/wiring flow, what is out of scope, the rejected alternatives
2. `implementation-plan.md` — the milestones and what "done" means for each
3. `risks-and-open-questions.md` — what could go wrong and what was decided
4. `IMPLEMENTATION-STATUS.md` — what actually shipped (kept distinct from intent)

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| CM0 — the spec | this doc set and the task contracts | merged on `main` |
| CM1 — the storefront on Workers | `apps/web` built by OpenNext with R2 + Durable Objects as the cache, rendered wrangler config, `tests/web` | `wrangler dev` serves the storefront, assets and OG image; the webhook enforces its secret and revalidates; Checks green |
| CM2 — the cache infrastructure from Terraform | `infra/terraform/cloudflare-r2`, the app's `secretEnv` and `dependsOn` | the root validates; the wiring keys match the template |
| CM3 — ready to instantiate | README, as-built status | a reader can run, test, preview, connect Shopify and deploy it |
| CM4 — a baseline, in one landing | card, build document, rename, bootstrap tooling, tests; the demo catalogue, cart page and checkout notice | a new storefront goes from nothing to live in one landing with no third-party key, the R2 bucket applied before the Worker; Baseline CI green |
| CM5 — the cirrus standard | no kiox, generated component docs, the context pack, status that agrees with the tags; the subdomain read from the Cloudflare connection | Baseline CI green with the docs check; the card asks for no subdomain |

# commerce — implementation plan

Milestones land in order; each task is one pull request on an
`orun/CM-n-<slug>` branch with an `Orun-Task: CM-n` trailer.

## CM0 — the spec

This doc set, `epic.yaml` and the task contracts, merged to `main`.

**Done when**
- the five documents and `epic.yaml` are on `main`
- `tasks/CM-1..CM-4.TaskContract.yaml` exist

## CM1 — the storefront on Workers

`apps/web` is the upstream template with the Workers build around it:
`open-next.config.ts` names the R2 incremental cache, the Durable Object
queue and the sharded Durable Object tag cache; `wrangler.template.jsonc` +
`wiring.fixture.json` render the config with the bucket binding, the two
Durable Object bindings and their migration, and the Worker's self-reference;
`tests/web` exercises the Shopify client's reshaping, the URL/env helpers
and the revalidation webhook without a network.

**Done when**
- `pnpm install && pnpm run wire:fixture && pnpm typecheck && pnpm lint && pnpm test && pnpm build` is green locally and in `Checks`
- `wrangler dev` over the built Worker, with no store configured, answers `/` with the storefront chrome (site name, search), `/robots.txt`, the CSS and favicon assets, and `/opengraph-image` as a PNG
- `POST /api/revalidate` answers `{"status":401}` without the secret and `{"status":200,"revalidated":true}` for a product or collection webhook with it, writing the tag to the Durable Object tag cache
- `"use cache"` results land in the (local) R2 bucket at request time

## CM2 — the cache infrastructure from Terraform

`infra/terraform/cloudflare-r2` provisions one bucket per environment and
publishes its name as the `WIRING_CLOUDFLARE_R2` secret; `apps/web/component.yaml`
depends on it and renders `wrangler.jsonc` from that document before the
build. The Durable Objects need no root: the Worker exports their classes and
the migration in the wrangler config creates them on the first deploy.

**Done when**
- `terraform validate` passes on the root
- the component's `secretEnv` keys match the root's `secretOutputs`
- the fixture's wiring keys match the template's tokens (`wire:fixture` renders)

## CM3 — ready to instantiate

README (run, test, preview, deploy; the Shopify connection: Storefront
token, store domain, webhook secret as Worker secrets, the menus and
collections the template expects, the revalidation webhook; what the first
deploy serves and when `populateCache` matters), `IMPLEMENTATION-STATUS.md`
with PRs and departures, epic `completed`.

**Done when**
- the README quick start works from a fresh clone with a `.dev.vars`
- the status file lists every PR and departure

## Sequencing note

CM1 and CM2 are independent files but CM1's component and wrangler template
already name the root's wiring document, so CM2 is the half that makes
those names true. Applying CM2 and deploying need a workspace with a
Cloudflare connection; until then the Orun lane is gated and `Checks` is
the merge gate. The Worker secrets (the Shopify facts) are set by hand once
per environment — the product's one manual step — and CM3 documents it.

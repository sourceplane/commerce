# commerce — implementation plan

Milestones land in order; each task is one pull request on an
`orun/CM-n-<slug>` branch with an `Orun-Task: CM-n` trailer.

## CM0 — the spec ✅

This doc set, `epic.yaml` and the task contracts, merged to `main`.

**Done when**
- the five documents and `epic.yaml` are on `main`
- `tasks/CM-1..CM-4.TaskContract.yaml` exist (CM-5 joined with CM4)

## CM1 — the storefront on Workers ✅

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

## CM2 — the cache infrastructure from Terraform ✅

`infra/terraform/cloudflare-r2` provisions one bucket per environment and
publishes its name as the `WIRING_CLOUDFLARE_R2` secret; `apps/web/component.yaml`
depends on it and renders `wrangler.jsonc` from that document before the
build. The Durable Objects need no root: the Worker exports their classes and
the migration in the wrangler config creates them on the first deploy.

**Done when**
- `terraform validate` passes on the root
- the component's `secretEnv` keys match the root's `secretOutputs`
- the fixture's wiring keys match the template's tokens (`wire:fixture` renders)

## CM3 — ready to instantiate ✅

README (run, test, preview, deploy; the Shopify connection: Storefront
token, store domain, webhook secret as Worker secrets, the menus and
collections the template expects, the revalidation webhook; what the first
deploy serves and when `populateCache` matters), `IMPLEMENTATION-STATUS.md`
with PRs and departures, epic `completed`.

**Done when**
- the README quick start works from a fresh clone with a `.dev.vars`
- the status file lists every PR and departure

## CM4 — a baseline, in one landing ✅

`blueprint.yaml`, `repo-blueprint.yaml` (two phases: `01-product`,
`02-docs`), `.baseline/` (identity, task contracts, the product's README),
`tooling/rebrand`, `tooling/bootstrap`, `hooks/render-deployment-docs.sh`,
`ai/context/`, `docs/phases/`, `BOOTSTRAP.md`, `testing/`, `baseline.yml`
and `tag.yml` (design §9); what the product needed to deploy from a fresh
repository — `wrangler.jsonc` committed, dev rendering the fixture,
`apps/web`'s enforced `dependsOn: cloudflare-r2` on main, the R2 root's own
`r2-data` key, `packages/` — and to go live with no third-party key: the demo
catalogue, the cookie cart, `/cart`, `/checkout`'s notice, no `SITE_URL`.

**Done when**
- orun at the bootstrap floor (v2.58.11), the lane pin (v2.78.4) and the
  current CLI (v2.79.0) reads `repo-blueprint.yaml`, and
  `testing/manifest.test.sh` holds the card to it
- the product's own push-to-main plan applies `cloudflare-r2` (with
  `CLOUDFLARE_R2_TOKEN`) before it deploys `web` on stage and prod
  (`testing/placement.test.sh`)
- a fresh build, served, renders home, a product and the cart; a product is
  added to the cart and checkout answers "connect a payment provider"
  (`testing/e2e.test.sh`)
- `Baseline CI` is green
- the status file records what is proven offline and what only a live
  bootstrap can prove

## CM5 — the cirrus standard ✅

Bring the baseline to cirrus-baseline's standard, with nothing about the
storefront itself changing.

- **No kiox.** `kiox.yaml`/`kiox.lock` pinned an orun (v2.15.0) that nothing
  ran: every workflow installs orun itself through `orun-action` with its own
  `version:`. The files, their two modules and the rebrand's skip entry go.
- **Component docs.** `tooling/catalog/gen-component-docs.py` writes each
  component's `docs/overview.md`, `docs/architecture.md` and `docs/runbook.md`
  from what the component declares, as cirrus-baseline's do; the pages ship
  with the component. Baseline CI runs it with `--check`.
- **The context pack.** `ai/context/current.md`, `decisions.md` and
  `open-risks.md` beside the two pages a product ships with — this
  repository's own, so no module places them.
- **Status that agrees with the tags.** CM4 is shipped and tagged; CM-B and
  the design's mapping say what CM4 built.
- **The subdomain from the Cloudflare connection (CM-7).** The card declares
  `subdomain` as `from: connection.cloudflare.workersSubdomain`, as
  cirrus-baseline does since baseline-v23, so the console asks for nothing the
  connection already knows; `testing/manifest.test.sh` requires the source's
  provider in `spec.requires.integrations`.

**Done when**
- `git grep -i kiox` finds nothing outside this milestone's own record
  (`specs/`, `tasks/`, `ai/context/`), and the leak gate and the offline
  bootstrap pass without the two modules
- the docs check is green in Baseline CI
- this file, the status file and `epic.yaml` agree

## CM6 — the domain is set later (CM-8) ✅

**Done when** the console card asks for no domain; `productdomain` is an
optional build input, empty by default; a store built without one is branded
with the reserved placeholder `<reponame>.example.com` where the domain goes
(`BASE_DOMAIN` in `intent.yaml`) and its README says how an owner sets the real one;
Baseline CI places, leak-checks and plans a store built with no domain.
Shipped in `baseline-v3`.

## After CM4 (outside this repository)

1. Cut `baseline-v1` with `tag.yml` from the merged `main`. ✅ Done.
2. Register the row in orun-cloud's `infra/baselines-registry/baselines.yaml`
   (unlisted) with the card vendored at the tag.
3. Bootstrap one product from the tag against a workspace (risk CM-M is the
   first thing it answers); record its timings; connect a Shopify development
   store to it once; then flip the row to public with a page on orunbase.com.

## Sequencing note

CM1 and CM2 are independent files but CM1's component and wrangler template
already name the root's wiring document, so CM2 is the half that makes
those names true. Applying CM2 and deploying need a workspace with a
Cloudflare connection; until then the Orun lane plans nothing
(`ws_CHANGE_ME`) and `Checks` is the merge gate. The Worker secrets (the
Shopify facts) are set by hand once per environment — the product's one
manual step, which CM3 documents and CM4 makes optional: a storefront without
them serves its demo catalogue. CM4 packages CM1–CM2 as a baseline whose one
landing applies CM2's root before it deploys CM1's Worker.

# commerce — where this repository stands

The entry page for anyone (or any agent) picking this repository up. It is
this repository's own state and does not ship to a storefront built from it;
the two pages that do are [operations.md](operations.md) and
[deployment.md](deployment.md).

## What it is

Vercel's Next.js Commerce (the Shopify headless storefront) on Cloudflare
Workers + Static Assets through `@opennextjs/cloudflare`, its Next.js cache in
an R2 bucket and two Durable Objects the Worker exports, packaged as an Orun
baseline: `orun new --blueprint repo-blueprint.yaml` builds a new storefront in
its own repository and takes it to live on stage and prod in one landing
(`01-product`) — the R2 bucket applied before the Worker that binds it — then
records what went live (`02-docs`). With no Shopify store connected it serves
a bundled demo catalogue and a cookie cart; checkout asks for a payment
provider.

## Release

| | |
|---|---|
| Latest tag | `baseline-v2` (CM5 — the cirrus standard, [#6](https://github.com/sourceplane/commerce/pull/6) and [#7](https://github.com/sourceplane/commerce/pull/7): no kiox, generated component docs, this context pack, and the workers.dev subdomain read from the Cloudflare connection instead of asked) |
| Before it | `baseline-v1` (CM4, [#5](https://github.com/sourceplane/commerce/pull/5)) |
| Proven live | No. Everything short of the platform is proven offline in Baseline CI; the tokens minted, a real R2 apply, a real `wrangler deploy` with the bucket and Durable Object bindings, the probes and a real Shopify store are still to come (risks CM-P, CM-M) |

## Where to read

| Question | Page |
|---|---|
| What shipped, and every departure from upstream | `specs/epics/commerce/IMPLEMENTATION-STATUS.md` |
| Why it is built this way | [decisions.md](decisions.md), then `specs/epics/commerce/design.md` |
| What could still go wrong | [open-risks.md](open-risks.md), then `specs/epics/commerce/risks-and-open-questions.md` |
| How to instantiate it | `BOOTSTRAP.md`, `docs/phases/` |
| What each component is | `apps/web/docs/`, `infra/terraform/cloudflare-r2/docs/`, `tests/web/docs/` (generated; `python3 tooling/catalog/gen-component-docs.py`) |

## Next

1. Bootstrap one storefront from `baseline-v2` against a workspace and record
   its timings; its deploy answers CM-M, and it closes CM-P. Connect a Shopify
   development store to it once.

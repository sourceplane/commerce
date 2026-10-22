# commerce — decisions

The choices that shape this repository, one line each, with where the full
reasoning lives. Superseded decisions stay listed, marked, so the history
reads in order.

| # | Decision | Why | Source |
|---|---|---|---|
| 1 | OpenNext on Workers + Static Assets | The template is a Next.js App Router storefront; `next/og`, server actions and route handlers run in the Worker | `specs/epics/commerce/design.md` §2 |
| 2 | The incremental cache in R2, the tag cache (sharded) and the revalidation queue in Durable Objects the Worker exports — no D1, no KV | Tag revalidation needs strong consistency; KV is eventually consistent | design.md §3, §8, risk CM-F |
| 3 | `experimental.useCache`, not `cacheComponents`; partial prerendering off | A Worker built with Cache Components hangs on every request under the adapter (opennextjs-cloudflare#1450) | risk CM-A |
| 4 | The `next/og` font is read through the `ASSETS` binding when the filesystem has none | A Worker has no filesystem | risk CM-D |
| 5 | `wrangler.jsonc` is rendered per environment from the R2 root's wiring document, and committed as the fixture render; `dev` renders the fixture | The deploy lane checks the file exists before it builds; no root applies to `dev` | risks CM-J, CM-K |
| 6 | The Shopify facts are Worker secrets an owner sets once per environment, and optional: without them a bundled demo catalogue and a cookie cart, the switch outside `"use cache"` | A baseline goes live with no key the platform cannot broker; a cached demo answer would outlive the connected store | risks CM-B, CM-N, design.md §9 |
| 7 | One landing (`01-product`) then the record (`02-docs`); the plan applies the bucket before the Worker (`dependsOn: cloudflare-r2`, enforced on `main`, advisory on a pull request) | A landing has a fixed cost; the plan, not the phases, carries deploy order (cirrus-baseline since `baseline-v22`) | design.md §9 |
| 8 | The R2 root has its own key, `CLOUDFLARE_R2_TOKEN` from `r2-data` | `workers-deploy` grants no R2 | risk CM-L |
| 9 | The store's identity is one seam (`app/site.ts`), the origin is the request's own (no `SITE_URL`), and shipped prose says "store" — never the slug | The slug is an English word the rename would rewrite everywhere | risk CM-O, design.md §9 |
| 10 | `ci.yml` plans nothing while `intent.yaml` names `ws_CHANGE_ME`; `checks.yml` runs on pull requests only | A bootstrap cannot set a repository variable (replaced the `ORUN_CI` gate); the convergence watch takes the newest run on the merge sha from any workflow | IMPLEMENTATION-STATUS (CM4) |
| 11 | stack-tectonic 0.19.0, not 0.20.0 | 0.20.0's lane-scoped install is refused by Next 16's Turbopack | IMPLEMENTATION-STATUS (CM4), design.md §9 |
| 12 | orun is pinned only where it runs (the `orun-action` `version:` in each workflow); no kiox. Component docs are generated from the manifests and checked in CI | `kiox.yaml` pinned a version nothing ran; a hand-written copy of the dependency graph and bindings drifts silently | IMPLEMENTATION-STATUS (CM5), `tooling/catalog/gen-component-docs.py` |
| 13 | `subdomain` is read from the Cloudflare connection (`from: connection.cloudflare.workersSubdomain`), never asked | It belongs to the account like its id and has one right answer; a typed one could only be wrong, and showed up after deploy in the smoke and the probes | `blueprint.yaml`, IMPLEMENTATION-STATUS (CM-7) |
| 14 | The console asks for no domain; an empty `productdomain` brands the placeholder `<reponame>.example.com` | The store goes live on workers.dev and nothing in the build needs a domain; attaching one is an owner's step, and the placeholder keeps every place the domain goes in the repository, ready to replace | `repo-blueprint.yaml`, `tooling/rebrand/rebrand.mjs`, IMPLEMENTATION-STATUS (CM-8) |

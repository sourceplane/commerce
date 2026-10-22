# commerce — operating contract (for humans and agents)

This is the standing guide to how this store is deployed and operated.
Instance facts (live URLs, workspace, secrets inventory) live in
[deployment.md](deployment.md), rendered from probed reality by the
bootstrap's `02-docs` phase; this file is the contract that stays true
between deployments. It is written to give an agent with repository read
access enough context to reason about and operate the store without any
other source.

## What this system is

A headless storefront on Cloudflare alone, expressed as an Orun
component-native desired-state repo.

- **`infra/terraform/cloudflare-r2`** — one R2 bucket per deployed
  environment (`stage`, `prod`), applied by Terraform: the storefront's
  Next.js incremental cache. After each apply it publishes a wiring document
  — `{r2_bucket_name}` — as the Orun secret `WIRING_CLOUDFLARE_R2` on that
  environment.
- **`apps/web`** — the storefront: Next.js built by `@opennextjs/cloudflare`
  into one Worker plus Static Assets. Every route renders per request. Its
  data comes from a connected Shopify store or, until one is connected, from
  the bundled demo catalogue (`lib/demo`), with the cart in a cookie. The
  Worker binds the bucket (`NEXT_INC_CACHE_R2_BUCKET`) and exports two
  Durable Objects: the tag cache and the revalidation queue.
- **`tests/web`** — the Shopify client, the demo catalogue and cart, the
  webhook and the URL helpers (vitest), verified on the `dev` rung.
- **`tooling/*`** — shared TypeScript and ESLint configuration, and the
  wrangler renderer that turns `wrangler.template.jsonc` plus a wiring
  document into `wrangler.jsonc`.

Environments: **`stage`** and **`prod`** are deployed; **`dev` is
verify-only by design** — lanes build and test, nothing deploys, and no
bucket exists for it (its build renders the committed fixture).

## Identity and tenancy

Every remote operation runs against ONE Orun workspace, declared in
`intent.yaml` under `execution.state.workspace` — committed, enforced, and
what CI uses. Do not remove it; headless credentials depend on it. If it
reads `ws_SET_ME`, the bootstrap had no workspace to write: set the real one
before anything else.

## How deployment works

1. Merge (or push) to `main`.
2. CI (`.github/workflows/ci.yml`) runs `orun plan --changed` — only
   components whose files changed are planned — then runs each planned lane
   with `orun run --remote-state`, authenticated by GitHub OIDC (the
   exchange resolves this repository's linked workspace server-side).
3. **The bucket before the Worker.** `cloudflare-r2` applies for the
   environment and publishes `WIRING_CLOUDFLARE_R2`. `apps/web` declares an
   enforced `dependsOn` on it for pushes to `main`, so its deploy starts only
   after that apply — and a job resolves its secrets when it starts, so the
   document is there.
4. `apps/web` renders `wrangler.jsonc` from that document (the real bucket
   name), builds once per environment, `wrangler deploy` ships
   `commerce-web-<env>` (the Durable Objects are created by the config's
   migration on the first deploy), and a smoke test fetches `/` and
   `/robots.txt` — which must name the origin it was asked on, proof the
   Worker itself rendered it.
5. `prod` deploys after `stage` has converged on the same commit
   (`environments.prod.promotion` in intent.yaml).
6. **The convergence run is the deployment.** A green run means every
   planned lane applied. Failed lanes are retried with
   `gh run rerun --failed`, which resumes the same execution.

On a pull request nothing applies or deploys: the R2 root plans, the
storefront builds and dry-deploys, and the edges in step 3 are advisory.

Caveats that matter:

- A push that touches no component files plans zero lanes — that run is
  green and deployed nothing. Never treat "latest run green" as "store
  converged"; probe the URLs instead.
- A change to `intent.yaml`'s `environments` maps to no component and
  redeploys nothing on its own. Land it with a change under `apps/web`.
- `wrangler.jsonc` is generated. Edit `wrangler.template.jsonc` and run
  `pnpm run wire:fixture`; Checks fails when the two disagree.

## The store backend

- **No store connected** (no `SHOPIFY_STORE_DOMAIN` secret on the Worker):
  every reader answers from `lib/demo`, the cart is the `demo-cart` cookie
  (variant ids and quantities; prices always re-read from the catalogue), a
  banner says the store is a demo, and `/checkout` answers 200 with "Connect
  a payment provider to enable checkout". Nothing is cached for the demo.
- **Shopify connected**: the three Worker secrets `SHOPIFY_STORE_DOMAIN`,
  `SHOPIFY_STOREFRONT_ACCESS_TOKEN`, `SHOPIFY_REVALIDATION_SECRET` (the
  README's "Connecting Shopify"). Readers go to the Storefront API and are
  cached in R2 (`"use cache"`, tagged `products` / `collections`); Shopify's
  webhooks hit `/api/revalidate?secret=…` to revalidate a tag; checkout is
  Shopify's hosted checkout, which takes payment through the store's own
  payment provider. The switch is per request: setting or deleting the
  secrets changes the backend without a redeploy.

## Secrets model

- **Brokered provider secrets**: `CLOUDFLARE_API_TOKEN` (the
  `workers-deploy` scope: Workers Scripts and KV Storage write) deploys the
  Worker; `CLOUDFLARE_R2_TOKEN` (the `r2-data` scope: R2 Storage write) is
  what the R2 root's Terraform authenticates with, because the deploy token
  carries no R2; `CLOUDFLARE_ACCOUNT_ID` is the connection fact both bind.
  Minted per run from the workspace's Cloudflare connection — no long-lived
  values at rest, nothing to rotate by hand.
- **Wiring**: `WIRING_CLOUDFLARE_R2` on `stage` and `prod`, written by the R2
  root's apply (lease-published), read by the Worker's build as
  `WIRING_CLOUDFLARE_R2_<ENV>`. It holds the bucket name, not a credential.
- **Store secrets**: Shopify's three facts are Worker secrets on
  `commerce-web-<env>`, set by the owner with `wrangler secret put`; the
  pipeline never reads or writes them.
- Inspect by NAME only: `orun secrets list --org <ws> --project` and
  `--env stage|prod`; `wrangler secret list --name commerce-web-<env>`. No
  tooling in this repository prints a secret value, and no document in
  `ai/context/` may contain one.

## Verifying the system

```bash
# the storefront on each environment (also recorded, probed, in deployment.md);
# robots.txt names the origin the Worker was asked on
curl -s https://commerce-web-stage.your-workers-subdomain.workers.dev/robots.txt | grep -i '^Host:'
curl -s -o /dev/null -w '%{http_code}\n' https://commerce-web-prod.your-workers-subdomain.workers.dev/
# which backend answers: the demo banner is on every page until a store is connected
curl -s https://commerce-web-prod.your-workers-subdomain.workers.dev/ | grep -c data-demo-banner

# the wiring the deploys read, and workspace readiness
orun secrets list --org <ws> --env stage && orun secrets list --org <ws> --env prod
orun integrations list --org <ws> --json && orun cloud check --org <ws>
```

## Common operations

| task | how |
|---|---|
| change the storefront | edit `apps/web` (its name and source link: `apps/web/app/site.ts`), merge |
| connect Shopify | the README's "Connecting Shopify": three Worker secrets per environment and the webhooks; no merge needed |
| change the demo catalogue | `apps/web/lib/demo/catalogue.ts` and its images in `apps/web/public/demo`, merge |
| deploy a change | merge to `main`; watch the run; failed lanes → `gh run rerun --failed` |
| redeploy without a change | edit the last line of `apps/web/component.yaml` (`# orun: redeploy <reason> <stamp>`) and merge — it is a deploy trigger, nothing reads it |
| empty the data cache | revalidate through the webhook route (a `products/update` or `collections/update` topic), or delete the bucket's `incremental-cache/` objects |
| add a binding (D1, KV, another bucket) | a Terraform root under `infra/terraform/` that publishes `WIRING_<ROOT>`, a token in `wrangler.template.jsonc`, its fixture entry, the root in the build's `--components`, the `WIRING_<ROOT>_<ENV>` secretEnv and an enforced `dependsOn` on it in `apps/web/component.yaml` |
| serve a custom domain | attach it to the Worker in Cloudflare (README, "Custom domain"), then replace the placeholder `commerce.example.com` in `intent.yaml`'s `BASE_DOMAIN` with it |
| add a runtime secret | `wrangler secret put <KEY> --name commerce-web-<env>` for the Worker; `orun secrets set <KEY> --org <ws> --env <env>` for a lane |
| headless credentials | `ORUN_TOKEN` (workspace-scoped) + `GITHUB_TOKEN` |

The deployment record is the bootstrap's `02-docs` phase. Re-running it (the
Orun console's Retry on that phase, or `orun new … --phase 02-docs`)
re-probes the URLs and re-renders [deployment.md](deployment.md); it is
idempotent.

## Evolution

Structural changes follow the same contract that deployed the store: add a
component under `apps/`, `infra/` or `packages/` with a `component.yaml`,
land it as a pull request, and the convergence run applies it. A different
store backend is a replacement for the functions `lib/shopify/index.ts`
exports; `lib/demo` implements the same surface.

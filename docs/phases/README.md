# The phases — one blueprint, two selections

`repo-blueprint.yaml` declares two phases that take a site from **nothing**
to **live on stage and prod, documented**. Run them one at a time with
`--phase <name>`, or the whole sequence unattended with `--resume`. There is
no umbrella workflow and no per-phase document: a phase is a selection on one
artifact, which is what makes running one alone, months later, from a fresh
container the same operation as running them all.

The product phase follows the contract every deploying phase does:

> **place its modules → brand them → land them as one pull request → watch
> the convergence that merge triggers (auto-resumed) → check what the
> convergence published → verify the outcome over HTTP.**

Run from the baseline checkout (the blueprint's source is `path: .`); the
site's repository is wherever `--out` points.

## Execution order

| phase | lands | verified by |
|---|---|---|
| [`01-product`](01-product.md) | **the GitHub repo created** and the whole product in ONE pull request: intent, CI, tooling, identity, the R2 root, the storefront and its tests | the convergence green (R2 applied, then the storefront built, deployed and smoke-tested), `WIRING_CLOUDFLARE_R2` on stage and prod, both URLs answering |
| [`02-docs`](02-docs.md) | the live-deployment record; the promotion gate and dev's lanes put back | committed manifest matches probed reality |

**One landing, not three.** Before the one-landing shape a site like this
landed its scaffold, its data plane and its app as separate pull requests,
because the bucket had to exist before the Worker that binds it. The plan
carries that order now: `apps/web` declares `dependsOn: cloudflare-r2` with
`mode: enforced` on a push to main, so the convergence that follows the one
merge applies the bucket first and deploys the storefront after it — and a
job resolves its secrets when it starts, so the bucket name the apply
published is there. On a pull request the edge is advisory: nothing deploys.
`testing/phases.test.sh` checks the edge; `testing/placement.test.sh` checks
the product's own plan honours it.

Every landing is a pull request on a branch named for its task
(`orun/BASE-<n>-<phase>`). On those branches `ci.yml` runs `plan` only — the
intent, every component and every composition resolve — and skips the lanes,
because the merge runs them on main a minute later, for real, and that
convergence is what the phase watches. `checks.yml` (install, the fixture
render, typecheck, lint, test, build) runs on every pull request regardless,
and the product's landing waits for it.

There is no custom-domain phase. Attaching a domain to a Worker needs zone
permissions the platform's brokered `workers-deploy` token does not carry, so
it is an owner's step after the bootstrap — the site's README, "Custom
domain", says how. Nothing in the repository changes for it: the storefront
builds its absolute links from the request.

## Inputs

`01-product` takes the site's identity once and writes it into the repo
(`.rebrand/values.json`); `02-docs` reads it back from the placed tree. But
the blueprint's **required** inputs — `reponame`, `productname`,
`githuborg` — are validated before any phase runs, so they must be supplied
on every invocation, single-phase ones included. A `--values` file is easier
than repeating `--set`.

- `productdomain` — NOT ASKED, default empty. The store goes live on
  workers.dev; empty brands the reserved placeholder `<reponame>.example.com`
  into `BASE_DOMAIN`, for an owner to replace when they attach a domain (the
  store's README, "Custom domain"). Pass it only for a store that already
  has its domain.

- `subdomain` — the workers.dev subdomain of the Cloudflare account you
  deploy into. It is in every URL the phases probe. A console or
  `--from bst_…` build reads it from the Cloudflare connection; pass it only
  for a hand-run build.
- `orunWorkspace` — workspace id (`ws_…`). Unset, it is the workspace the
  build runs in (`from: workspace`); with none anywhere, a placeholder that
  fails loudly rather than silently claiming another tenant's workspace.
- `epicSlug` (default `commerce-baselining`) — the epic every phase clubs
  its task under. Found by slug, so a fresh run and a resumed run find the
  same work.
- `repoPrivate` (default `true`) — the repository's visibility at creation.

```bash
orun new --blueprint repo-blueprint.yaml \
  --out $HOME/sites/acme-shop --run-hooks --phase 01-product \
  --values ~/acme-shop.values.yaml
```

Drop `--run-hooks` (or add `--status`) to preview. Without it a phase places
files and stops: no repo, no landing, no convergence watch, and no probe —
which is exactly what makes a dry instantiation of this baseline possible in
CI with no workspace and no provider (`testing/placement.test.sh`,
`testing/e2e.test.sh`).

## What the product phase does after it places

Placement writes the baseline's files as they are here. Before the phase
lands, its `post` hooks make them the site's:

1. `retouch` — one `# orun: redeploy 01-product <stamp>` line at the end of
   each component.yaml its task contract names (`cloudflare-r2`, `web`,
   `web-tests`), so a re-run after a failed convergence still has a diff to
   land and re-plans exactly those components.
2. `git init`, stage, `rebrand`, the workspace rewrite, the work-tree strip,
   the two bootstrap deferrals (prod's promotion gate, dev's push lanes),
   restage, `rebrand --verify` — the identity rename over the whole tree,
   then a sweep that fails on any of this baseline's identity left behind.
3. `pnpm install --lockfile-only` — confirms the baseline's complete
   lockfile against the placed tree, so `--frozen-lockfile` installs pass.
4. `repo`, `link`, the brokered Cloudflare credentials, `land`.

## When a phase fails

- **Before it lands** (a probe that timed out, a rebrand residue, a refused
  link): nothing was merged. Fix what the message names and re-run the phase.
- **After it lands** (the convergence went red): the files are on main.
  `orun.run/watch@v1` has already resumed the run up to three times. Re-run
  the phase (`--phase 01-product`, `--redo 01-product` under `--resume`, or
  the console's Retry): its `retouch` hook gives the landing a diff and the
  R2 root and the storefront re-plan.

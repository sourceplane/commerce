#!/usr/bin/env bash
# TIER 2 — the product a bootstrap produces builds, deploys (dry) and serves.
#
# placement.test.sh proves the tree a bootstrap ends with is the right tree.
# This proves it WORKS, by doing to it what its own pipelines will:
#
#   1. at the 01-product landing (the commit its one pull request merges),
#      run what `checks.yml` runs on that PR — install with the lockfile the
#      phase confirmed, render the wrangler fixture and check the committed
#      config IS that render, typecheck, lint, test, build. The landing WAITS
#      on those checks, so a product they refuse is a bootstrap that never
#      merges;
#   2. the stage lane's own steps, rendered by `orun plan` in the product for
#      a pull request (the verify profile: the deploy profile has no dry run)
#      — `verify-app-structure` (which checks the wrangler config exists
#      BEFORE anything is built), `build-app` (the component's buildCommand:
#      the live wiring render, then the build), `verify-build-output` and
#      `deploy-dry-run` (`wrangler deploy --dry-run --name <reponame>-web-stage`).
#      They run IN THE TREE THE RUNNER STAGES for the job
#      (testing/lib/stage-job.py), with the dependency layout the pinned
#      composition produces, and with the stage wiring document in the job's
#      environment as the platform resolves it (the component's secretEnv) —
#      so the bucket name in the built config is asserted to be the
#      document's, not the fixture's;
#   3. serve the built Worker with `wrangler dev` (a local R2 bucket and local
#      Durable Objects) and run the component's OWN `smokeCommand` against it,
#      verbatim — the check the real deploy ends with — and then do what a
#      shopper does on a fresh deploy with NO third-party key: the home page
#      carries the product's name, its source link and the demo catalogue;
#      browse to a product, pick its options, ADD IT TO THE CART through the
#      storefront's own server action (the call the browser makes, by the id
#      the build gave it), see it in the cart, add it again, and proceed to
#      checkout — which answers with "connect a payment provider", not a 500.
#      Then every other route the storefront promises: search, a collection,
#      a page, robots.txt and the sitemap on the origin they were asked on,
#      the Open Graph images, the static assets, and 404s.
#
# What it cannot do is the platform's half: create the repository, mint the
# brokered Cloudflare tokens, apply the bucket, deploy for real and probe
# workers.dev — or reach a real Shopify store. The R2 root is verified to
# `terraform validate` (CM2) and its plan is part of every pull request's
# lanes; the apply needs an account.
#
# Needs: orun, node, pnpm, python3 (+PyYAML), git, curl, and the network for
# `pnpm install` and the build's Google Font (or a warm store). A few minutes:
# two installs and builds.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
# shellcheck source=lib/bootstrap.sh
source "$here/lib/bootstrap.sh"

for bin in orun node pnpm python3 git curl; do
  command -v "$bin" >/dev/null || { echo "e2e.test.sh needs $bin on PATH" >&2; exit 1; }
done

scratch="$(mktemp -d)"
dev_pid=""
# wrangler dev runs under pnpm, node and two workerd processes; a TERM to the
# first does not reach the rest, and waiting on it then never returns. So it is
# started as its own process group (setsid) and the whole group is stopped.
cleanup() {
  if [ -n "$dev_pid" ]; then
    kill -TERM -- "-$dev_pid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 -- "-$dev_pid" 2>/dev/null || break; sleep 0.5; done
    kill -KILL -- "-$dev_pid" 2>/dev/null || true
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT
values="$here/fixtures/acme.json"
repo="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['reponame'])" "$values")"
export CI=1 WRANGLER_SEND_METRICS=false NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1

# What checks.yml runs, step for step, read out of the workflow the product
# carries so the two cannot drift: every `run:` of its one job, in order.
checks() { # DIR LOG
  local dir="$1" log="$2" cmd
  while IFS= read -r cmd; do
    echo "   \$ $cmd" | tee -a "$log"
    if ! (cd "$dir" && bash -c "$cmd") >> "$log" 2>&1; then
      echo "FAIL: \`$cmd\` failed in $dir" >&2; tail -40 "$log" >&2; return 1
    fi
  done < <(python3 - "$dir/.github/workflows/checks.yml" <<'PY'
import sys, yaml
wf = yaml.safe_load(open(sys.argv[1]))
for job in wf["jobs"].values():
    for step in job["steps"]:
        if "run" in step:
            print(step["run"].strip())
PY
)
}

echo "── the offline bootstrap (testing/lib/bootstrap.sh)"
tree="$scratch/$repo"
bootstrap_offline "$root" "$tree" "$values" "$scratch/logs" > "$scratch/bootstrap.log" 2>&1 || {
  echo "FAIL: the offline bootstrap stopped" >&2; tail -40 "$scratch/bootstrap.log" >&2; exit 1; }
echo "   2 phases placed and landed"
s01="$(git -C "$tree" rev-parse HEAD~1)"

# ── 1. the product's one pull request ──────────────────────────────────────
echo "── 01-product's landing, under the checks its PR waits on"
git -C "$tree" worktree add -q "$scratch/at-01" "$s01"
checks "$scratch/at-01" "$scratch/checks-01.log"
# The first Checks build is done; its tree is not needed again, and the disk is shared.
git -C "$tree" worktree remove --force "$scratch/at-01"

# ── 2. the stage lane's steps, in the job's own tree ──────────────────────
echo "── the stage lane: verify-app-structure, build-app, verify-build-output, deploy-dry-run"
# A pull request that changes the page: the lane `orun plan` gives it.
git -C "$tree" checkout -q -b e2e-pr
echo "<!-- a change to the page's component -->" >> "$tree/apps/web/README.md"
git -C "$tree" -c user.email=e2e@example.invalid -c user.name=e2e commit -qam "a pull request"
(cd "$tree" && orun plan --intent intent.yaml --trigger github-pull-request --changed \
   --base main --head HEAD --env stage --output "$scratch/plan.json") > "$scratch/plan.log" 2>&1 \
  || { echo "FAIL: orun plan" >&2; tail -15 "$scratch/plan.log" >&2; exit 1; }
python3 - "$scratch/plan.json" "$scratch/steps" <<'PY'
import json, pathlib, sys
plan = json.load(open(sys.argv[1]))
out = pathlib.Path(sys.argv[2]); out.mkdir()
job = next(j for j in plan["jobs"] if j["component"] == "web" and j["environment"] == "stage")
for s in job["steps"]:
    if s["id"] in ("verify-app-structure", "build-app", "verify-build-output", "deploy-dry-run"):
        (out / f"{s['id']}.sh").write_text(s.get("run") or "")
    if s["id"] == "install-workspace-dependencies":
        (out / "install.sh").write_text(s.get("run") or "")
        (out / "install.wd").write_text(s.get("working-directory") or ".")
        (out / "install.scope").write_text(s.get("scope") or "job")
(out / "path").write_text(job.get("path") or "apps/web")
for k, v in (job.get("env") or {}).items():
    (out / "env").open("a").write(f"export {k}={json.dumps(v)}\n")
(out / "secrets").write_text("\n".join(r["asEnv"] for r in job.get("secretRefs") or []))
PY
# The job's private tree, staged as orun stages it. The source checkout
# carries no build output (nothing was built in it), and its dependencies are
# what the pinned composition says: a lane-scoped install ran once in the
# source tree and is linked in, or the job installs its own.
work="$tree/.orun/runs/e2e/web.stage.verify-deploy/work"
[ -f "$scratch/steps/install.sh" ] || { echo "FAIL: the stage lane has no install step" >&2; exit 1; }
if [ "$(cat "$scratch/steps/install.scope")" = lane ]; then
  (cd "$tree" && bash -e "$scratch/steps/install.sh") > "$scratch/install.log" 2>&1 \
    || { echo "FAIL: the lane's install step" >&2; tail -30 "$scratch/install.log" >&2; exit 1; }
  python3 "$here/lib/stage-job.py" "$tree" "$work" --shared-deps
  [ -L "$work/node_modules" ] || { echo "FAIL: the staged tree's node_modules is not the lane's symlink" >&2; exit 1; }
  echo "   staged: $(realpath --relative-to="$tree" "$work"); install scope: lane — node_modules → the source tree's"
else
  python3 "$here/lib/stage-job.py" "$tree" "$work"
  echo "   staged: $(realpath --relative-to="$tree" "$work"); install scope: job — installing inside it"
  echo "   ▸ install-workspace-dependencies"
  (cd "$work/$(cat "$scratch/steps/path")/$(cat "$scratch/steps/install.wd")" && bash -e "$scratch/steps/install.sh") \
    > "$scratch/install.log" 2>&1 || { echo "FAIL: the lane's install step" >&2; tail -30 "$scratch/install.log" >&2; exit 1; }
  [ -d "$work/node_modules" ] && [ ! -L "$work/node_modules" ] \
    || { echo "FAIL: the job's install did not land inside its own tree" >&2; exit 1; }
fi
[ ! -e "$work/apps/web/.open-next" ] || { echo "FAIL: the staged tree carries build output" >&2; exit 1; }
# What the platform resolves into the job before its first step: the wiring
# documents the R2 root lease-published (the component's secretEnv), shaped as
# its `wiring` output — `{r2_bucket_name}`. Names no fixture carries, so the
# built config proves which one it was rendered from.
for env in stage prod; do
  key="WIRING_CLOUDFLARE_R2_$(echo "$env" | tr a-z A-Z)"
  grep -qx "$key" "$scratch/steps/secrets" || { echo "FAIL: the stage lane does not resolve $key" >&2; exit 1; }
done
export WIRING_CLOUDFLARE_R2_STAGE='{"r2_bucket_name":"stg-'"$repo"'-stage-applied"}'
export WIRING_CLOUDFLARE_R2_PROD='{"r2_bucket_name":"prod-'"$repo"'-prod-applied"}'
for step in verify-app-structure build-app verify-build-output deploy-dry-run; do
  [ -f "$scratch/steps/$step.sh" ] || { echo "FAIL: the stage verify lane has no $step step" >&2; exit 1; }
  echo "   ▸ $step"
  # The runner's per-job environment: the job's env (intent environment
  # `env:`), its resolved secrets, and ORUN_ENVIRONMENT; the step runs in the
  # component's directory.
  if ! (cd "$work/$(cat "$scratch/steps/path")" && \
        { [ -f "$scratch/steps/env" ] && source "$scratch/steps/env"; true; } && \
        export ORUN_ENVIRONMENT=stage && bash -e "$scratch/steps/$step.sh") > "$scratch/$step.log" 2>&1; then
    echo "FAIL: the deploy lane's $step step" >&2; tail -40 "$scratch/$step.log" >&2; exit 1
  fi
done
grep -q "\"stg-$repo-stage-applied\"" "$work/apps/web/wrangler.jsonc" \
  || { echo "FAIL: the lane's build did not render the stage bucket name from its wiring document" >&2; exit 1; }
grep -q 'NEXT_INC_CACHE_R2_BUCKET' "$scratch/deploy-dry-run.log" && grep -q "stg-$repo-stage-applied" "$scratch/deploy-dry-run.log" \
  || { echo "FAIL: the dry run does not bind NEXT_INC_CACHE_R2_BUCKET to the stage bucket" >&2; tail -20 "$scratch/deploy-dry-run.log" >&2; exit 1; }
grep -q 'NEXT_TAG_CACHE_DO_SHARDED' "$scratch/deploy-dry-run.log" && grep -q "WORKER_SELF_REFERENCE" "$scratch/deploy-dry-run.log" \
  || { echo "FAIL: the dry run lost the Durable Object or self-reference bindings" >&2; tail -20 "$scratch/deploy-dry-run.log" >&2; exit 1; }
echo "   the built config binds NEXT_INC_CACHE_R2_BUCKET to the stage document's bucket; the dry run accepts it"
# The id the build gave each server action: what the storefront's client
# calls, read from the manifest the build wrote into the job's tree.
actions="$work/apps/web/.next/server/server-reference-manifest.json"
[ -f "$actions" ] || { echo "FAIL: the build wrote no server-reference manifest" >&2; exit 1; }

# ── 3. serve it, and smoke it as the deploy does ───────────────────────────
echo "── wrangler dev over the built Worker"
port=$(python3 -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()")
(cd "$work/apps/web" && exec setsid pnpm exec wrangler dev --config wrangler.jsonc --ip 127.0.0.1 --port "$port" \
   --name "$repo-web-stage" --show-interactive-dev-session=false) > "$scratch/dev.log" 2>&1 < /dev/null &
dev_pid=$!
url="http://127.0.0.1:$port"
for _ in $(seq 1 90); do
  curl -s -o /dev/null "$url/favicon.ico" && break
  kill -0 "$dev_pid" 2>/dev/null || { echo "FAIL: wrangler dev exited" >&2; tail -30 "$scratch/dev.log" >&2; exit 1; }
  sleep 1
done
curl -s -o /dev/null "$url/favicon.ico" || { echo "FAIL: wrangler dev never answered" >&2; tail -30 "$scratch/dev.log" >&2; exit 1; }

echo "   ▸ the component's own smokeCommand, DEPLOYED_URL=$url"
smoke="$(python3 -c "import yaml,sys;print(yaml.safe_load(open(sys.argv[1]))['spec']['parameters']['smokeCommand'])" "$tree/apps/web/component.yaml")"
DEPLOYED_URL="$url" bash -c "$smoke" || { echo "FAIL: the deploy's smoke refused the page" >&2; exit 1; }

echo "   ▸ a shopper on a fresh deploy: browse, add to cart, check out — then every route"
python3 - "$url" "$values" "$actions" <<'PY'
import html, json, re, sys, urllib.error, urllib.parse, urllib.request
base, values, actions = sys.argv[1], json.load(open(sys.argv[2])), json.load(open(sys.argv[3]))
name, repo, org = values["productname"], values["reponame"], values["githuborg"]
problems = []
def bad(m): problems.append(m)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None
opener = urllib.request.build_opener(NoRedirect)
jar = {}
def request(path, data=None, headers=None, method=None):
    h = dict(headers or {})
    if jar:
        h["Cookie"] = "; ".join(f"{k}={v}" for k, v in jar.items())
    req = urllib.request.Request(base + path, data=data, headers=h, method=method)
    try:
        r = opener.open(req, timeout=60)
    except urllib.error.HTTPError as e:
        r = e
    for c in r.headers.get_all("set-cookie") or []:
        k, _, v = c.split(";", 1)[0].partition("=")
        jar[k.strip()] = v.strip()
    return r.status, r.headers, r.read()
def get(path):
    s, h, b = request(path)
    return s, h.get("content-type", ""), b
def text(b): return b.decode("utf-8", "replace")
def flight(page):
    # The RSC payload the page carries for its client components, unescaped.
    return page.replace('\\"', '"').replace("\\\\", "\\")

# ── the home page: the product's own, on its demo catalogue ──────────────
status, _, body = get("/")
page = text(body)
if status != 200:
    bad(f"/ answered {status}")
title = re.search(r"<title>(.*?)</title>", page, re.S)
if not title or html.unescape(title.group(1)) != name:
    bad(f"the home page's <title> is {title and title.group(1)!r}, not {name!r}")
if html.unescape(page).count(name) < 2:
    bad(f"the home page does not carry the store's name {name!r} in its navbar and footer")
links = set(re.findall(r'href="(https://github\.com/[^"]*)"', page))
if links != {f"https://github.com/{org}/{repo}"}:
    bad(f"the home page's repository links are {sorted(links)}, not github.com/{org}/{repo}")
for residue in ("Next.js Commerce", "sourceplane/commerce", "vercel.com/templates"):
    if residue in page:
        bad(f"the home page still carries {residue!r}")
og = re.search(r'<meta property="og:image" content="([^"]+)"', page)
if not og or not og.group(1).startswith(f"{base}/opengraph-image"):
    bad(f"og:image is {og and og.group(1)!r} — not absolute on the origin it was asked on ({base})")
if "data-demo-banner" not in page:
    bad("the home page shows no demo banner — a fresh deploy must say its catalogue is a demo")
products = list(dict.fromkeys(re.findall(r'href="/product/([a-z0-9-]+)"', page)))
if len(products) < 3:
    bad(f"the home page links {len(products)} product(s); the demo catalogue's grid and carousel link more")

# ── browse to a product, pick its options, add it to the cart ────────────
add = next((k for k, v in (actions.get("node") or {}).items()
            if v.get("exportedName") == "addItem" and "components/cart/actions" in (v.get("filename") or "")), None)
if not add:
    bad("the build's server-reference manifest has no addItem action")
handle = products[0] if products else "cloud-tee"
status, _, body = get(f"/product/{handle}")
pdp = text(body)
if status != 200:
    bad(f"/product/{handle} answered {status}")
variants = re.findall(r'"id":"([^"]+)","title":"([^"]+)","availableForSale":(true|false),"selectedOptions":\[(.*?)\]',
                      flight(pdp))
variant = next(((vid, vt, opts) for vid, vt, avail, opts in variants if avail == "true"), None)
if not variant:
    bad(f"/product/{handle} carries no available variant in its payload")
elif add:
    vid, vtitle, opts = variant
    options = re.findall(r'"name":"([^"]+)","value":"([^"]+)"', opts)
    query = urllib.parse.urlencode({k.lower(): v for k, v in options if k != "Title"})
    path = f"/product/{handle}" + (f"?{query}" if query else "")
    status, _, body = get(path)
    if status != 200 or 'aria-label="Add to cart"' not in text(body):
        bad(f"{path} answered {status} without an enabled Add To Cart button")
    for n in (1, 2):
        status, headers, body = request(path, data=json.dumps([None, vid]).encode(), method="POST", headers={
            "Next-Action": add or "", "Content-Type": "text/plain;charset=UTF-8",
            "Accept": "text/x-component", "Origin": base})
        if status != 200 or "demo-cart" not in jar:
            bad(f"adding {vid} (#{n}) answered {status}; cookies {sorted(jar)}")
            break
    status, _, body = get("/cart")
    cart = text(body)
    line = re.search(rf'data-cart-line="{re.escape(vid)}".*?data-cart-quantity="true">(\d+)<', cart, re.S)
    if status != 200 or not line:
        bad(f"/cart answered {status} without the line for {vid}")
    elif line.group(1) != "2":
        bad(f"/cart has {line.group(1)} of {vid} after two adds, not 2")

    # ── proceed to checkout: the plain form post, no JavaScript ─────────
    checkout = re.search(r'name="(\$ACTION_ID_[0-9a-f]+)"', cart)
    if not checkout:
        bad("/cart renders no checkout form")
    else:
        boundary = "e2eboundary"
        form = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{checkout.group(1)}\"\r\n\r\n\r\n"
                f"--{boundary}--\r\n").encode()
        status, headers, _ = request("/cart", data=form, method="POST", headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}", "Origin": base})
        if status not in (303, 307) or headers.get("location") != "/checkout":
            bad(f"Proceed to Checkout answered {status} → {headers.get('location')!r}, not a redirect to /checkout")
    status, _, body = get("/checkout")
    if status != 200 or "Connect a payment provider to enable checkout" not in text(body):
        bad(f"/checkout answered {status} without the 'connect a payment provider' notice")
    print(f"   / → /product/{handle}?{query} → Add To Cart ×2 (action {add[:10]}…) → /cart: 2 × {vtitle}"
          f" → Proceed to Checkout → /checkout: \"Connect a payment provider\"")

# ── every other route the storefront promises ────────────────────────────
status, _, body = get("/search?q=mug")
found = set(re.findall(r'href="/product/([a-z0-9-]+)"', text(body)))
if status != 200 or found != {"cache-mug"}:
    bad(f"/search?q=mug answered {status} with {sorted(found)}, not the mug alone")
for path, must in (("/search", "/product/"), ("/search/apparel", "/product/"), ("/about", "demo catalogue")):
    status, _, body = get(path)
    if status != 200 or must not in text(body):
        bad(f"{path} answered {status} without {must!r}")
# THE ROUTE ONLY THE WORKER ANSWERS (beside the cart): robots.txt and the
# sitemap are rendered per request on the origin they were asked on.
status, _, body = get("/robots.txt")
if status != 200 or f"Host: {base}" not in text(body):
    bad(f"/robots.txt answered {status} without Host: {base}")
status, _, body = get("/sitemap.xml")
if status != 200 or f"<loc>{base}/product/{handle}</loc>" not in text(body):
    bad(f"/sitemap.xml answered {status} without {base}/product/{handle}")
for path, want, ctype in (("/opengraph-image", 200, "image/png"), ("/about/opengraph-image", 200, "image/png"),
                          ("/favicon.ico", 200, "image/"), ("/demo/cloud-tee-black.svg", 200, "image/svg+xml"),
                          ("/no-such-page", 404, "text/html"), ("/product/no-such-product", 404, "text/html")):
    s, ct, b = get(path)
    if s != want or not ct.startswith(ctype):
        bad(f"{path} answered {s} {ct}, want {want} {ctype}")
    if ct.startswith("image/png") and b[:8] != b"\x89PNG\r\n\x1a\n":
        bad(f"{path} is not a PNG")

if problems:
    for p in problems:
        print(f"  ✕ {p}", file=sys.stderr)
    sys.exit(1)
print(f"   search, a collection, a page, robots.txt and the sitemap on the asked origin, the Open Graph")
print(f"   images, the demo's static assets and two 404s — the product's own, with no third-party key")
PY

echo "e2e.test.sh: ok"

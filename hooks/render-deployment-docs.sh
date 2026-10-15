#!/usr/bin/env bash
# Render the store's LIVE-DEPLOYMENT documentation from verified state.
# Called by phase 02-docs as a `run:` hook (and safe to run by hand, from the
# site's checkout). Idempotent: the generated file and the README section are
# fully re-rendered on every run, so re-running after a redeploy or a custom
# domain refreshes them.
#
#   hooks/render-deployment-docs.sh <out> <workspace> <baseline-dir>
#
# What it writes (in <out>):
#   ai/context/deployment.md   — REGENERATED: URLs with live probe results (and
#                                whether the Worker rendered the request's
#                                origin, and which store backend answered),
#                                identity, the R2 wiring, secrets inventory BY
#                                NAME, integrations
#   ai/context/operations.md   — healed from the baseline's copy if absent
#                                (the static operating contract; never rewritten)
#   README.md                  — the section between <!-- 02-docs:begin/end -->
#                                is replaced (appended after the title if the
#                                README predates the markers)
#
# No secret VALUE is ever read or written here — inventories are names only.
set -euo pipefail

out="${1:?usage: render-deployment-docs.sh <out> <workspace> <baseline-dir>}"
ws="${2:-}"
L="${3:?usage: render-deployment-docs.sh <out> <workspace> <baseline-dir>}"

cd "$out"
vals=".rebrand/values.json"
[ -f "$vals" ] || { echo "render-docs: $vals missing — is this a scaffolded site?" >&2; exit 1; }
val() { python3 -c "import json,sys;print(json.load(open('$vals')).get(sys.argv[1],'') or '')" "$1"; }

repo="$(val reponame)"
brand="$(val brandSlug)"; [ -n "$brand" ] || brand="$repo"
sub="$(val subdomain)"; [ -n "$sub" ] || sub="your-workers-subdomain"
[ -n "$ws" ] || ws="$(sed -n 's/^[[:space:]]*workspace:[[:space:]]*\([^[:space:]#]*\).*/\1/p' intent.yaml | head -1)"
[ -n "$ws" ] || ws="?"

# Workspace slug via the direct backend read; tolerate failure.
slug="$( { orun workspace "$ws" 2>/dev/null || true; } | sed -n 's/^ *slug: *//p' | head -1)"
[ -n "$slug" ] || slug="?"

# CI lane pin (what version the deploy lanes run).
lanepin="$(sed -n 's/^ *version: *\(v[0-9.]*\) *$/\1/p' .github/workflows/ci.yml 2>/dev/null | head -1)"
[ -n "$lanepin" ] || lanepin="?"

# Every route is rendered per request by the Worker, and robots.txt names the
# origin it was asked on — so a robots.txt that names the probed URL is the
# Worker answering, not a cached or static file. The home page says which
# store backend answered: the demo banner is on every page until a Shopify
# store is connected. curl emits the -w format even on connection failure
# (000) — capture, don't append, or a failed probe reads "000000".
probe() { # URL → "<code> <worker|no-worker> <demo|store>"
  local body robots code worker backend
  body="$(mktemp)"; robots="$(mktemp)"
  code="$(curl -s -o "$body" -w '%{http_code}' --max-time 20 "$1/" 2>/dev/null)" || true
  curl -s -o "$robots" --max-time 20 "$1/robots.txt" 2>/dev/null || true
  if grep -qiF "Host: $1" "$robots" 2>/dev/null; then worker=worker; else worker=no-worker; fi
  if grep -q 'data-demo-banner' "$body" 2>/dev/null; then backend=demo; else backend=store; fi
  printf '%s %s %s' "${code:-000}" "$worker" "$backend"
  rm -f "$body" "$robots"
}
badge() { # "<code> <worker|no-worker> <demo|store>"
  local code worker backend
  read -r code worker backend <<<"$1"
  case "$code" in
    2*)
      if [ "$worker" != worker ]; then echo "answering $code, robots.txt not rendered by the Worker"
      elif [ "$backend" = demo ]; then echo "LIVE ($code) — demo catalogue (no store connected)"
      else echo "LIVE ($code) — store connected"; fi ;;
    3*) echo "LIVE ($code)" ;;
    000) echo "unreachable" ;;
    *) echo "answering $code" ;;
  esac
}

stage_url="https://${brand}-web-stage.${sub}.workers.dev"
prod_url="https://${brand}-web-prod.${sub}.workers.dev"
rows=""
for pair in "stage|$stage_url" "prod|$prod_url"; do
  env="${pair%%|*}"; url="${pair#*|}"
  rows+="| storefront (${env}) | ${url} | $(badge "$(probe "$url")") |"$'\n'
done

secrets_list() { { orun secrets list --org "$ws" "$@" 2>/dev/null || true; } | awk 'NR>1 && NF {print "  - "$1}'; }
secrets_proj="$(secrets_list --project)"; [ -n "$secrets_proj" ] || secrets_proj="  - (listing unavailable to this credential)"
secrets_stage="$(secrets_list --env stage)"; [ -n "$secrets_stage" ] || secrets_stage="  - (listing unavailable to this credential)"
secrets_prod="$(secrets_list --env prod)"; [ -n "$secrets_prod" ] || secrets_prod="  - (listing unavailable to this credential)"
integrations="$( { orun integrations list --org "$ws" --json 2>/dev/null || true; } | python3 -c "
import json,sys
try: rows=json.load(sys.stdin)
except Exception: rows=[]
out=[f\"  - {r.get('provider','?')}: {r.get('status','?')}\" for r in rows]
print('\n'.join(out) if out else '  - (listing unavailable to this credential)')" )"

now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Heal the static operating contract when the site predates it.
mkdir -p ai/context
if [ ! -f ai/context/operations.md ] && [ -f "$L/ai/context/operations.md" ]; then
  cp "$L/ai/context/operations.md" ai/context/operations.md
  git add ai/context/operations.md 2>/dev/null || true
  node "$L/tooling/rebrand/rebrand.mjs" --values "$vals" --allow-dirty >/dev/null 2>&1 || true
  echo "render-docs: healed ai/context/operations.md"
fi

cat > ai/context/deployment.md <<EOF
# ${repo} — live deployment manifest

> GENERATED by the \`02-docs\` phase on ${now}; re-run it to refresh
> (idempotent; see [operations.md](operations.md)). Hand-edits here are
> overwritten. No secret values appear in this file — inventories are names
> only.

## Identity

| | |
|---|---|
| repository / project slug | \`${repo}\` |
| Orun workspace | \`${ws}\` (slug \`${slug}\`) |
| declared in | \`intent.yaml\` → \`execution.state.workspace\` |
| Workers | \`${brand}-web-stage\`, \`${brand}-web-prod\` on \`${sub}.workers.dev\` |
| R2 buckets (the Next.js data cache) | \`stg-${repo}-stage\`, \`prod-${repo}-prod\` (\`infra/terraform/cloudflare-r2\`); their names reach the Workers as \`WIRING_CLOUDFLARE_R2\` on each environment |
| CI lane CLI pin | orun \`${lanepin}\` (\`.github/workflows/ci.yml\`) |

## Public URLs (probed ${now})

| surface | URL | status |
|---|---|---|
${rows}
The \`dev\` environment is verify-only by design — no deployed URL and no
bucket. Until a Shopify store is connected (the README's "Connecting
Shopify"), each storefront serves its bundled demo catalogue and \`/checkout\`
asks for a payment provider.

## Secrets inventory (names only)

Project rung:
${secrets_proj}

Environment \`stage\`:
${secrets_stage}

Environment \`prod\`:
${secrets_prod}

Provider secrets are BROKERED (minted per run from the workspace's Cloudflare
connection; no long-lived values at rest). \`WIRING_CLOUDFLARE_R2\` is written
by the R2 root's apply and holds the bucket name, not a credential. Shopify's
facts, once connected, are Worker secrets on the Workers above, not Orun
secrets, and are not listed here.

## Workspace integrations

${integrations}

## How this deployment changes

Merges to \`main\` converge automatically: CI plans the changed components and
runs each lane with \`orun run --remote-state\` against the workspace above —
the R2 bucket first, then the storefront. See [operations.md](operations.md) for
the full operating contract.
EOF
echo "render-docs: wrote ai/context/deployment.md"

python3 - <<'PY'
import re
begin, end = "<!-- 02-docs:begin -->", "<!-- 02-docs:end -->"
body = f"""{begin}
This store is **live**. Verified URLs, identity and the secrets inventory are
recorded in [ai/context/deployment.md](ai/context/deployment.md) (re-rendered
by the `02-docs` phase); how it deploys and how to operate it:
[ai/context/operations.md](ai/context/operations.md).
{end}"""
s = open("README.md").read()
if begin in s and end in s:
    s = re.sub(re.escape(begin) + r".*?" + re.escape(end), lambda _m: body, s, count=1, flags=re.S)
else:
    lines = s.splitlines(keepends=True)
    at = 1
    while at < len(lines) and lines[at].strip() == "":
        at += 1
    lines.insert(at, f"\n## Live deployment\n\n{body}\n")
    s = "".join(lines)
open("README.md", "w").write(s)
print("render-docs: README live-deployment section rendered")
PY
echo "render-docs: done"

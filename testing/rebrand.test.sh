#!/usr/bin/env bash
# THE REBRAND WRITES EACH VALUE ONCE, AND WHAT IT WROTE STAYS WRITTEN.
#
# Drives the real tooling/rebrand/rebrand.mjs over one-file trees and compares
# the file. Each case is a shape this baseline's identity actually takes in the
# tree — the source link, the store-name seam, the worker name in the
# component and the wrangler config (and the Worker's self-reference binding),
# the R2 bucket names and the terraform `repo` they are built from, the
# placeholder domain, a secret ref — and the survival cases run through three
# passes, so a value an earlier rebrand wrote (a re-run phase re-runs the
# rebrand over everything placed) comes out of every later one unchanged.
#
# This baseline's slug is an English word and its capitalised form is the
# second word of the store's display name, so two cases pin the hazard that
# makes shipped prose avoid both: the word in prose IS the slug to the rename,
# and the display name anywhere but its seam is residue.
#
# The identity is PINNED (fixtures/baseline-identity.commerce.json) rather
# than read from .baseline/identity.json: what this tests is the engine, and
# its fixtures spell the identity out literally.
#
# Needs: node, git. No network.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
rebrand="$here/../tooling/rebrand/rebrand.mjs"
identity="$here/fixtures/baseline-identity.commerce.json"

fail=0
# check NAME VALUES-JSON FILE CONTENT WANT [PASSES]
check() {
  local name="$1" values="$2" file="$3" content="$4" want="$5" passes="${6:-1}"
  local tmp got out i
  tmp="$(mktemp -d)"
  git -C "$tmp" init -q
  mkdir -p "$tmp/$(dirname "$file")" "$tmp/.rebrand"
  printf '%s\n' "$content" > "$tmp/$file"
  printf '%s\n' "$values" > "$tmp/.rebrand/values.json"
  for ((i = 1; i <= passes; i++)); do
    git -C "$tmp" add -A
    if ! out="$(cd "$tmp" && node "$rebrand" --baseline-identity "$identity" --values .rebrand/values.json --allow-dirty 2>&1)"; then
      echo "   ✕  $name: rebrand pass $i failed:" >&2
      printf '%s\n' "$out" | sed 's/^/        /' >&2
      fail=1
      rm -rf "$tmp"
      return
    fi
  done
  got="$(cat "$tmp/$file")"
  rm -rf "$tmp"
  if [ "$got" = "$want" ]; then
    echo "   ok  $name"
  else
    echo "   ✕  $name:" >&2
    echo "        got:  $got" >&2
    echo "        want: $want" >&2
    fail=1
  fi
}

acme='{"reponame":"acme-shop","productname":"Acme Shop","productdomain":"shop.acme.dev","githuborg":"acme-inc","subdomain":"acme","orunWorkspace":"ws_79BDXAZQ"}'

echo "── rebrand: the store's own identity"
check "the source link names the product's owner and repository" \
  "$acme" apps/web/app/site.ts \
  'export const SOURCE_URL = "https://github.com/sourceplane/commerce";' \
  'export const SOURCE_URL = "https://github.com/acme-inc/acme-shop";'
check "the store-name seam takes the product's name" \
  "$acme" apps/web/app/site.ts 'export const SITE_NAME = "Next.js Commerce";' \
  'export const SITE_NAME = "Acme Shop";'
check "…and stays a valid string for a name with an apostrophe and an ampersand" \
  '{"reponame":"sams-shop","productname":"Sam'"'"'s Tees & Mugs","productdomain":"sam.dev"}' \
  apps/web/app/site.ts 'export const SITE_NAME = "Next.js Commerce";' \
  'export const SITE_NAME = "Sam'"'"'s Tees & Mugs";'
check "the worker name is re-prefixed" \
  "$acme" apps/web/component.yaml 'workerName: commerce-web' \
  'workerName: acme-shop-web'
check "the wrangler config's worker name, the environment token kept" \
  "$acme" apps/web/wrangler.template.jsonc '  "name": "commerce-web-__ENV__",' \
  '  "name": "acme-shop-web-__ENV__",'
check "the Worker's self-reference binding names the same Worker" \
  "$acme" apps/web/wrangler.jsonc \
  '    { "binding": "WORKER_SELF_REFERENCE", "service": "commerce-web-stage" },' \
  '    { "binding": "WORKER_SELF_REFERENCE", "service": "acme-shop-web-stage" },'
check "the environment URLs: worker name and subdomain" \
  "$acme" intent.yaml '    url: https://commerce-web-stage.your-workers-subdomain.workers.dev' \
  '    url: https://acme-shop-web-stage.acme.workers.dev'
check "the R2 root's terraform repo — every bucket name is built on it" \
  "$acme" infra/terraform/cloudflare-r2/terraform/main.tf '  default = "commerce"' \
  '  default = "acme-shop"'
check "the per-environment terraform repo parameter" \
  "$acme" intent.yaml '        repo: commerce' \
  '        repo: acme-shop'
check "a fixture's bucket name follows the same rule" \
  "$acme" apps/web/wiring.fixture.json '    "r2_bucket_name": "stg-commerce-stage"' \
  '    "r2_bucket_name": "stg-acme-shop-stage"'
check "the placeholder domain is the product's domain, not a renamed slug" \
  "$acme" intent.yaml '      BASE_DOMAIN: commerce.example.com' \
  '      BASE_DOMAIN: shop.acme.dev'
check "the repo slug" \
  "$acme" package.json '  "name": "commerce",' \
  '  "name": "acme-shop",'
check "a wiring secret ref names the product's workspace and project" \
  "$acme" apps/web/component.yaml \
  '    WIRING_CLOUDFLARE_R2_STAGE: "secret://commerce/commerce/stage/WIRING_CLOUDFLARE_R2"' \
  '    WIRING_CLOUDFLARE_R2_STAGE: "secret://ws_79BDXAZQ/acme-shop/stage/WIRING_CLOUDFLARE_R2"'
check "the R2 root's templated token ref too" \
  "$acme" infra/terraform/cloudflare-r2/component.yaml \
  '    CLOUDFLARE_API_TOKEN: "secret://commerce/commerce/{{ .environment }}/CLOUDFLARE_R2_TOKEN"' \
  '    CLOUDFLARE_API_TOKEN: "secret://ws_79BDXAZQ/acme-shop/{{ .environment }}/CLOUDFLARE_R2_TOKEN"'
check "org-owned identity is not renamed" \
  "$acme" intent.yaml 'apiVersion: sourceplane.io/v1 # mail ops@sourceplane.ai' \
  'apiVersion: sourceplane.io/v1 # mail ops@sourceplane.ai'
check "without githuborg the source link keeps the baseline's owner" \
  '{"reponame":"acme-shop","productname":"Acme Shop","productdomain":"shop.acme.dev"}' \
  apps/web/app/site.ts 'const SOURCE_URL = "https://github.com/sourceplane/commerce";' \
  'const SOURCE_URL = "https://github.com/sourceplane/acme-shop";'
check "THE HAZARD: the slug is a word, and in prose the rename takes it for the slug" \
  "$acme" apps/web/README.md 'a headless commerce store' \
  'a headless acme-shop store'

echo "── rebrand: a written value is not rewritten, in any later pass"
contains='{"reponame":"commerce-2","productname":"Next.js Commerce 2","productdomain":"commerce.example.com.au","githuborg":"sourceplane","subdomain":"your-workers-subdomain-2"}'
check "a repo slug containing the baseline's slug survives three passes" \
  "$contains" package.json '  "name": "commerce",' \
  '  "name": "commerce-2",' 3
check "a worker name built on it survives three passes" \
  "$contains" apps/web/component.yaml 'workerName: commerce-web' \
  'workerName: commerce-2-web' 3
check "a bucket name built on it survives three passes" \
  "$contains" apps/web/wiring.fixture.json '"r2_bucket_name": "prod-commerce-prod"' \
  '"r2_bucket_name": "prod-commerce-2-prod"' 3
check "a domain containing the baseline's domain survives three passes" \
  "$contains" intent.yaml 'BASE_DOMAIN: commerce.example.com' \
  'BASE_DOMAIN: commerce.example.com.au' 3
check "a subdomain containing the placeholder survives three passes" \
  "$contains" apps/web/component.yaml 'workersDevSubdomain: your-workers-subdomain' \
  'workersDevSubdomain: your-workers-subdomain-2' 3
check "a store name containing the baseline's name survives three passes" \
  "$contains" apps/web/app/site.ts 'export const SITE_NAME = "Next.js Commerce";' \
  'export const SITE_NAME = "Next.js Commerce 2";' 3
prefixed='{"reponame":"acme-commerce","productname":"Sam'"'"'s Tees & Mugs","productdomain":"shop.acme.dev","githuborg":"acme-inc","subdomain":"acme","orunWorkspace":"ws_79BDXAZQ"}'
check "a slug that ENDS in the baseline's slug survives three passes (the e2e fixture's)" \
  "$prefixed" apps/web/wrangler.jsonc '"service": "commerce-web-stage"' \
  '"service": "acme-commerce-web-stage"' 3
check "…and so does its bucket name" \
  "$prefixed" apps/web/wiring.fixture.json '"r2_bucket_name": "stg-commerce-stage"' \
  '"r2_bucket_name": "stg-acme-commerce-stage"' 3

# --verify runs in every phase. Without the product's values it cannot tell
# the product's own identity from a leftover; with them it can. A real
# leftover must fail it either way.
verify() { # NAME VALUES FILE CONTENT WANT(pass|fail) [--values]
  local name="$1" values="$2" file="$3" content="$4" want="$5" withvalues="${6:-}" tmp got
  tmp="$(mktemp -d)"
  git -C "$tmp" init -q
  mkdir -p "$tmp/$(dirname "$file")" "$tmp/.rebrand"
  printf '%s\n' "$content" > "$tmp/$file"
  printf '%s\n' "$values" > "$tmp/.rebrand/values.json"
  git -C "$tmp" add -A
  if (cd "$tmp" && node "$rebrand" --baseline-identity "$identity" --verify ${withvalues:+--values .rebrand/values.json} >/dev/null 2>&1); then got=pass; else got=fail; fi
  rm -rf "$tmp"
  if [ "$got" = "$want" ]; then echo "   ok  $name"; else echo "   ✕  $name: --verify ${got}ed, want $want" >&2; fail=1; fi
}
echo "── rebrand --verify: the product's own identity is not residue"
verify "given the values, a slug containing the baseline's passes" \
  "$contains" package.json '"name": "commerce-2"' pass --values
verify "without them it cannot know, and fails" \
  "$contains" package.json '"name": "commerce-2"' fail
verify "given the values, a real leftover still fails" \
  "$acme" package.json '"name": "commerce"' fail --values
verify "a leftover worker name fails" \
  "$acme" apps/web/wrangler.jsonc '"name": "commerce-web-stage",' fail --values
verify "a leftover bucket name fails" \
  "$acme" apps/web/wiring.fixture.json '"r2_bucket_name": "stg-commerce-stage"' fail --values
verify "THE HAZARD: the display name outside its seam fails (no rule renames it — so nothing may spell it)" \
  "$acme" apps/web/components/welcome-toast.tsx 'toast("Welcome to Next.js Commerce!")' fail --values
verify "a clean product passes" \
  "$acme" package.json '"name": "acme-shop"' pass --values
verify "a product whose own name carries the capitalised word passes, given the values" \
  '{"reponame":"acme-shop","productname":"Acme Commerce","productdomain":"shop.acme.dev"}' \
  apps/web/app/site.ts 'export const SITE_NAME = "Acme Commerce";' pass --values

echo "── rebrand: a residue it cannot rename fails the rebrand itself"
tmp="$(mktemp -d)"; git -C "$tmp" init -q; mkdir -p "$tmp/.rebrand" "$tmp/apps/web"
printf '%s\n' "$acme" > "$tmp/.rebrand/values.json"
printf 'const x = "COMMERCE_TOKEN"\n' > "$tmp/apps/web/x.ts"
git -C "$tmp" add -A
if (cd "$tmp" && node "$rebrand" --baseline-identity "$identity" --values .rebrand/values.json --allow-dirty >/dev/null 2>&1); then
  echo "   ✕  an unrenamable env-var prefix passed the rebrand" >&2; fail=1
else
  echo "   ok  an unrenamable env-var prefix fails the rebrand, naming the file"
fi
rm -rf "$tmp"

[ "$fail" -eq 0 ] || exit 1
echo "rebrand.test.sh: ok"

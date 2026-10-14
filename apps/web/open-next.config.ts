// OpenNext Cloudflare adapter config.
//
// The storefront caches Shopify responses with `"use cache"` (tagged
// `collections` / `products`, `cacheLife("days")`) and revalidates them on
// demand from Shopify webhooks through `revalidateTag` (app/api/revalidate).
// That is Next's data cache plus its tag cache, which on Workers live in
// bindings:
//
//   incremental cache → R2 (NEXT_INC_CACHE_R2_BUCKET): every pre-rendered
//                       page, static shell and `"use cache"` entry
//   tag cache         → a sharded Durable Object (NEXT_TAG_CACHE_DO_SHARDED):
//                       which tags were revalidated when, consulted on every
//                       cache read so a stale entry is re-rendered
//   queue             → a Durable Object (NEXT_CACHE_DO_QUEUE): deduplicated
//                       background revalidation of stale ISR entries, which
//                       calls the Worker back through WORKER_SELF_REFERENCE
//
// The bucket is provisioned by infra/terraform/cloudflare-r2 and wired into
// wrangler.jsonc per environment; the Durable Objects are classes the
// generated Worker exports (DOQueueHandler, DOShardedTagCache) and the
// `migrations` in wrangler.template.jsonc create on deploy. No D1, no KV.
import { defineCloudflareConfig } from "@opennextjs/cloudflare/config";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import doShardedTagCache from "@opennextjs/cloudflare/overrides/tag-cache/do-sharded-tag-cache";

export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  queue: doQueue,
  tagCache: doShardedTagCache({ baseShardSize: 12 }),
});

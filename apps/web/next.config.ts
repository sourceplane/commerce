import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Upstream turns on `experimental.ppr`, `useCache` and `inlineCss` on a Next
  // 15.6 canary. On Next 16 — the adapter's floor — `ppr` and `useCache` were
  // merged into `cacheComponents`, whose staged rendering @opennextjs/cloudflare
  // 1.20 cannot yet run on workerd (opennextjs-cloudflare#1450; every
  // request hangs). `experimental.useCache` still enables the `"use cache"`
  // directives on their own (deprecated, a warning), which is the data cache
  // this storefront needs; partial prerendering is off, so routes render
  // dynamically — as they did upstream, where the root layout's cart promise
  // left every route without a static shell.
  experimental: {
    inlineCss: true,
    useCache: true,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.shopify.com",
        pathname: "/s/files/**",
      },
    ],
  },
  // Required by @opennextjs/cloudflare, which bundles `.next/standalone/**`
  // into the Worker. Trace from the monorepo root so workspace dependencies
  // resolve from the root node_modules.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;

// `next dev` reaches the Worker's bindings (the R2 cache bucket, the cache
// Durable Objects) through a local miniflare built from wrangler.jsonc.
initOpenNextCloudflareForDev();

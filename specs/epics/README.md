# Epics

Orun-style work programs. Each epic is a folder carrying `epic.yaml` (the
declaration the platform reads: slug, key prefix, milestones with exit
criteria and task keys) beside its doc set. The pull request that adds the
folder is the adoption; the merge creates the epic in the workspace.

| Epic | Cluster | Status | What it is |
|------|---------|--------|------------|
| [`commerce/`](./commerce/) | **CM** | ✅ Shipped (`baseline-v1`); live bootstrap pending | Vercel's Next.js Commerce, equivalent in code and function, on Cloudflare Workers with the Shopify Storefront API as its backend — and an Orun baseline that instantiates it in one landing, live on a bundled demo catalogue until a store is connected (CM4) |

As-built ≠ intent: what shipped lives in each epic's `IMPLEMENTATION-STATUS.md`.

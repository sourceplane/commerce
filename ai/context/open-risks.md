# commerce — open risks

What is not yet proven or not yet decided. The full write-up of every risk,
including the accepted and resolved ones, is
`specs/epics/commerce/risks-and-open-questions.md`; this page lists only what
is still live, so it should be short.

| ID | Risk | State | What closes it |
|---|---|---|---|
| CM-P | No live bootstrap yet: the repository created and linked, the two tokens minted, a real `terraform apply`, a real `wrangler deploy` with the R2 and Durable Object bindings, the probes and a real Shopify store are all unproven | OPEN | One bootstrap from a tag against a workspace |
| CM-M | The deploy uploads a Worker that binds the bucket with the `workers-deploy` token, which has no R2 permission; whether Cloudflare's upload check needs it is undocumented | OPEN | The first live deploy (if refused: give the deploy the `r2-data` key, not drop the binding) |

Accepted, and worth knowing before you change them: CM-E (images served
unoptimised), CM-F (a webhook racing a render), CM-H (Next/OpenNext versions
pinned together; mitigated), CM-I (upstream's own prettier check), CM-O (the
slug is an English word; gated), CM-Q (the bootstrap floor plans every edge
enforced), CM-R (a custom domain is the owner's step).

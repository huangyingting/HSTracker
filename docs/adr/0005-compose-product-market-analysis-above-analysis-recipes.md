---
status: accepted
---

# Compose product-level Market Analysis above existing analysis recipes

HS Tracker presents one product-level Market Analysis through a deep Module above `TradeAnalyticsPlatform`, rather than exposing recipe coordination to the UI, adding a generic question router, or treating Market Analysis as another Analysis Recipe.

The Module accepts one Candidate Market Context and returns stable product evidence areas for opportunity standing, demand, exporter position, supplier landscape, and evidence quality. Existing Analysis Recipes remain the sole owners of calculations, Dataset Package compatibility, Analysis Identity, missingness, and typed outcomes. Market Analysis projects those outcomes without creating a composite Analysis Identity, product-level score, aggregate confidence, prediction, or recommendation.

Analyst questions are requirements and acceptance probes. They do not enter the production interface as identifiers, catalogs, handlers, result fields, routes, or generic UI cards. This keeps the product model stable when wording or research priorities change while preserving traceability that the product can support the intended analyst work.

Annual Candidate Market, Trade Trend, and Supplier Competition evidence fails closed as one coherent product view when shared provenance disagrees. Recent Trade Momentum remains separately identified adjacent evidence. Commercial evidence gaps are presented as a Validation Plan with no speculative Adapters.

This trades a smaller extension surface for stronger depth, locality, reproducibility, and protection against silently mixing annual, monthly, public, operational, and future access-controlled evidence.

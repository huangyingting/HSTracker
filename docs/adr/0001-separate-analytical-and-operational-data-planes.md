---
status: accepted
---

# Separate analytical and operational data planes

HS Tracker keeps immutable annual evidence, cross-product Opportunity Indexes,
and monthly signal packages in read-only DuckDB Dataset Packages, while one
business-storage interface owns accounts, a primary export economy, confirmed
product portfolios, Opportunity Watches, alert events, and delivery state.
The hosted product uses independently managed PostgreSQL; a complete but
strictly single-instance lightweight deployment uses SQLite, with separate
adapters, shared behavioral contract tests, database-specific operational
tests, and a verified one-way SQLite-to-PostgreSQL migration. Analytical facts
and per-user analytical result copies never enter either operational store.

This separation preserves content-addressed analytical replay and low-cost
embedded scans without asking DuckDB to own concurrent mutable user state. It
also gives SQLite an explicit product role instead of pretending it is
behaviorally identical to PostgreSQL, while keeping non-reconstructible hosted
account data outside the application Machine and its analytical volume.
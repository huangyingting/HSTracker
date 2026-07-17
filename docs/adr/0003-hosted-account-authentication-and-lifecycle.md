---
status: accepted
---

# Hosted account authentication and lifecycle

HS Tracker's hosted product authenticates an analyst with an email identity and
a password, and represents a signed-in analyst with a server-side session
rather than a self-contained bearer token. Password verifiers are derived with
`scrypt` from the Node standard library — no native or third-party crypto
dependency — using a per-credential random salt and a stored cost parameter, so
verifiers can be re-derived and upgraded without a schema change. A session is
an opaque random token; only its digest is stored, sessions expire, and signing
out or deleting the account revokes them. Account recovery issues a single-use,
short-lived token whose digest alone is stored; the plaintext is handed to the
delivery channel and never persisted. Repeated failed authentication throttles
and then temporarily locks a credential, and every security-relevant lifecycle
event (created, signed in, sign-in refused, recovered, exporter changed,
deleted) is appended to an operational audit log.

Credentials, sessions, recovery tokens, and the audit log live in the same
operational data plane as accounts, portfolios, watches, alert events, and
delivery state, behind the one business-storage interface of ADR 0001. The
hosted deployment uses independently managed PostgreSQL and a complete but
strictly single-instance lightweight deployment uses SQLite; both adapters
implement the identical behavioral contract, so an account — including its
authentication, primary exporter, and confirmed portfolio — behaves the same on
either engine. Authentication logic (hashing, session issuance, lockout) lives
above the store in a database-agnostic account service, which keeps the two
adapters behaviorally identical by construction. Only durable business records
(accounts, credentials, portfolios, and the audit log) cross the one-way
SQLite-to-PostgreSQL migration; sessions and recovery tokens are ephemeral
runtime state and are never migrated, exactly as evaluation leases are not.

The single primary export economy is validated against the compatible economy
catalog at the moment it is chosen or changed, and only the resolved economy
code is stored. Changing it is an explicit account operation. Because the
account references an economy code and never holds analytical facts, and because
Analysis Identities are immutable content-addressed products of a recipe, a
package, and an export economy, changing an account's primary exporter can never
mutate a historical Analysis Identity. A confirmed product enters the portfolio
only after an explicit HS12 confirmation step: free-text search terms and any
model or alias output are discovery candidates, never a canonical HS Product
identity, and the service refuses to persist an unconfirmed or catalog-invalid
code. Products are validated against the versioned product catalog so a code
that is not a real HS12 identity is rejected before it reaches the store.

Account deletion removes all operational state for the account — credentials,
sessions, recovery tokens, portfolio, watches, alert events, and delivery state
— in one transaction under the recorded retention policy, and writes a deletion
record to the audit log so the erasure itself is accountable. Deletion touches
only the operational plane: it never reads, rewrites, or removes any immutable
analytical Dataset Package, because per-user copies of analytical results never
exist in the operational store in the first place.

This decision keeps authentication provider-agnostic and free of vendor lock-in,
keeps non-reconstructible account and credential data outside the analytical
Machine and its volumes, and preserves the ADR 0001 boundary: operational state
composes analytical catalogs to validate input but never becomes an analytical
input itself. The managed-PostgreSQL host, region, backup and point-in-time
recovery posture, data-processing agreement, and outbound email-delivery
provider remain hosting decisions tracked separately and do not change this
account model.

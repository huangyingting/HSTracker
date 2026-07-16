# HS Tracker

HS Tracker helps export-oriented businesses interpret public international merchandise-trade data to identify markets worth further investigation.

## Language

**Export Market Analyst**:
A person at an export-oriented business who evaluates foreign markets for a product and decides where deeper commercial investigation is warranted.
_Avoid_: Generic user, trader, researcher

**Candidate Market**:
An importing economy whose public trade indicators signal that it is worth deeper commercial investigation for a specific export economy and HS product. It is evidence for investigation, not a prediction of profit or sales success.
_Avoid_: Trade opportunity, guaranteed opportunity, recommended investment

**Candidate Market Score**:
A transparent, fixed-weight summary used to rank Candidate Markets, accompanied by component indicators and a data-confidence measure. It is a discovery aid, not a standalone recommendation.
_Avoid_: Opportunity score, success probability, AI recommendation

**Market Investigation Candidate**:
One eligible importing economy for one export economy and one HS Product under the cross-product opportunity-discovery recipe. It is public evidence for further investigation, not a commercial recommendation or prediction.
_Avoid_: Guaranteed opportunity, sales lead, recommended investment

**Market Attractiveness**:
A cross-product percentile composite of an importing market's recorded product-specific size and nominal growth. It does not measure accessibility, profitability, or fit for a particular company.
_Avoid_: Addressable market, demand forecast, market potential

**Exporter Fit**:
A cross-product percentile composite of an export economy's recorded world presence in an HS Product and recorded foothold in one importing market. It describes public trade evidence, not a company's capability, certification, price, or channel fit.
_Avoid_: Company fit, product-market fit, success probability

**Investigation Priority**:
The fixed ordinal summary used to order Market Investigation Candidates for one export economy and exact Dataset Package. It does not estimate sales, profit, or commercial value.
_Avoid_: Opportunity value, revenue potential, recommendation score

**Unvalidated Market Gap**:
A Market Investigation Candidate with high recorded Market Attractiveness and weak or unrecorded exporter foothold. It is a hypothesis requiring access, competition, capability, and commercial validation.
_Avoid_: Untapped market, guaranteed whitespace, unmet demand

**HS Product**:
A six-digit product category under an explicitly named Harmonized System revision. Its identity is the revision and code; source descriptions, auxiliary translations, and search aliases help discovery but do not change that identity.
_Avoid_: Unversioned HS code, SKU, brand, model, free-text product

**BACI Release**:
One indivisible dated version of CEPII BACI used by an analysis. Earlier annual evidence may differ between BACI Releases, so releases are never mixed in one Candidate Market Score.
_Avoid_: Live data, calendar-year dataset, mixed release

**Finalized Year**:
A year eligible for scoring in a specific BACI Release because it precedes that release's newest year. Finalized describes scoring treatment, not permanent immutability; a later BACI Release may revise it.
_Avoid_: Final forever, unrevisable year, current year

**Provisional Year**:
The newest year in a BACI Release, retained as separately labelled supporting evidence because it may be incomplete or materially revised. It never affects score, rank, or Data Confidence.
_Avoid_: Latest score year, current data, preliminary score

**Recent Trade Momentum Signal**:
A source-specific comparison of recently recorded imports for one reporting market and HS Product against the same calendar period one year earlier. It remains separate from annual BACI scores and is not a forecast or exporter-specific opportunity.
_Avoid_: Real-time demand, leading indicator, monthly Candidate Market Score

**Monthly Source Vintage**:
One immutable extraction of an official monthly trade source and its metadata at a recorded instant. A later extraction is a different vintage even when its newest reference month is unchanged.
_Avoid_: Live monthly data, mutable monthly table, latest file

**Opportunity Watch**:
A user's request to evaluate one reporting-market and HS Product context when a new eligible monthly Dataset Package is activated. It stores evaluation and delivery state, not a mutable copy of analytical facts.
_Avoid_: Live market monitor, saved analysis result, trading alert

**Release Revision**:
A difference in same-period BACI evidence between two BACI Releases associated with one selected deployment. It is distinct from change over time within one release, and distinct from replaying an older Retained Deployment: selecting a retained predecessor changes which deployment's own Release Revision evidence applies, and never borrows the current deployment's own comparison evidence.
_Avoid_: Historical growth, year-over-year trend, cross-deployment comparison

**Source Freshness Status**:
The checked relationship between the BACI Release currently served and the latest release known to HS Tracker. Its derived runtime representation also reports the process's distinct Deployment Activation Mode so a Last Verified Resident Fallback is visible without changing freshness identity or analytical values. It does not describe the age, completeness, or immutability of an individual trade year.
_Avoid_: Live status, real-time data, data age

**Candidate Market Context**:
The source release, analysis build, selected export economy, HS product identity, and one Candidate Market that together identify the scope for adjacent evidence. It identifies an analytical context, not a buyer-supplier relationship.
_Avoid_: Trade lane customer, company market, buyer market

**Analysis Recipe**:
A fixed, versioned analytical method that defines its semantic inputs, required evidence, interpretation rules, and result meaning. Changing its formula, window, missingness treatment, quality rules, or ordering creates a new version.
_Avoid_: User-authored formula, arbitrary query, mutable analysis

**Dataset Package**:
An immutable, content-addressed publication of source evidence, identity, coverage, quality, attribution, and versioned analytical capabilities. Missing observations within a supported capability are distinct from a capability the package does not provide.
_Avoid_: Live dataset, mutable database, universal nullable dataset

**Analysis Identity**:
The deterministic identity of one Analysis Recipe version applied to one exact Dataset Package and normalized semantic inputs. Locale, execution time, cache state, request origin, and presentation choices do not change it.
_Avoid_: Request ID, page URL, cache key

**Analysis Request**:
A typed request to apply one Analysis Recipe to explicit semantic inputs and an eligible current or pinned analytical context. It expresses analytical intent, not storage, query-language, or presentation instructions.
_Avoid_: SQL query, report configuration, free-form prompt

**Analysis Outcome**:
The complete typed result of an Analysis Request, distinguishing successful evidence, empty evidence, invalid input, incompatibility, retirement, resource rejection, and temporary unavailability. Expected non-success states are evidence about the request or serving context, not analytical values.
_Avoid_: Untyped response, generic failure, partial result

**Recommended Dataset Mapping**:
An immutable published association between one or more compatible Analysis Recipe versions, their reviewed Dataset Package evidence, and compatible discovery catalogs. A running deployment fixes one mapping rather than choosing evidence heuristically, and it activates each declared recipe only after that recipe's own capability, checksum, schema, and smoke-query validation.
_Avoid_: Latest-dataset lookup, runtime package selection, mutable recommendation

**Trade Analysis Context**:
The Analysis Recipe, Dataset Package, normalized semantic inputs, and Analysis Identity that establish the reproducible scope of a trade analysis. Candidate Market Context is its Candidate Market-specific form, additionally focused on one Candidate Market.
_Avoid_: Browser session, user project, hidden account state

**Canonical Task Link**:
The exact URL encoding one Analysis Recipe, its normalized inputs, locale, and, once resolved, the pinned analysis build and Dataset Package identity of the Trade Analysis Context it reproduces. Copy, reload, browser back/forward, and opening in another browser all reproduce the same pinned meaning; a link with no pin yet resolves against the current Recommended Dataset Mapping instead of silently carrying one over from elsewhere.
_Avoid_: Deep link, permalink, arbitrary query string

**Pinned** / **Current** / **Retained** (Canonical Task Link):
A Canonical Task Link is Pinned once it carries an exact analysis build and Dataset Package identity; it is Current only while that identity still matches the live Recommended Dataset Mapping, and Retained while that identity instead matches one of the two preceding deployments still kept within the Deployment Retention Window. A Retained link still executes its exact Analysis Identity. A Pinned link matching neither is retired and must not execute against today's evidence or superseded retained evidence under the old pin; it surfaces a typed actionable state instead.
_Avoid_: Stale cache, expired session, silent fallback to latest

**Deployment Retention Window**:
The current published platform deployment plus its two preceding compatible complete deployments, each binding one deployment pairing, analysis release catalog, current artifact, Recommended Dataset Mapping, product catalog, and source/freshness provenance without mixing recipe, data, or catalog generations. All three are immutable, checksum-verified, and made resident at startup so each replays without any request-time object-storage access; publication and rollback keep this window's current/history order coherent and fail closed rather than exceed it.
_Avoid_: Cache generation, version history, backup snapshot

**Current** / **Last Verified Resident Fallback** (Deployment Activation Mode):
The runtime's own truthful, machine-readable record of how a process reached readiness, fixed for that process's entire lifetime. Current when startup hydrated and verified the live active deployment pointer's own candidate. Last Verified Resident Fallback when that pointer's current Recommended Dataset Mapping could not be retrieved or validated, so startup instead atomically reactivated the entire last durably committed resident deployment -- current plus its retained history, from one verified activation record -- never mixing remote current with resident evidence. Object-store recovery never hot-swaps a running process; only a controlled restart can activate a different mapping. It is a distinct runtime concept from Source Freshness Status, which continues to describe BACI Release currency rather than control-plane serving provenance, and is never inferred ad hoc from a caught exception.
_Avoid_: Rollback state, degraded mode with no distinct field, silent fallback

**Explicit Current Refresh**:
The deliberate user action that discards a Canonical Task Link's existing pin and resolves its Trade Analysis Context again against the current Recommended Dataset Mapping, producing a distinct Canonical Task Link and Analysis Identity. It never happens automatically and never substitutes current evidence under an old pin.
_Avoid_: Automatic fallback, silent re-fetch, cache invalidation

**Candidate Market Result Export**:
An immutable tabular snapshot of the complete ranked Candidate Market cohort for one export economy and HS Product under explicit analysis, product-catalog, and freshness identities. It carries derived evidence and provenance for follow-up, not raw trade records or company evidence.
_Avoid_: BACI export, raw-data extract, buyer list

**Trade Trend**:
A deterministic five-Finalized-Year view of one importing economy's nominal current-USD imports for one HS Product, with recorded positive values, no recorded positive flow, and missing observations kept distinct. It is evidence for investigation, not a forecast.
_Avoid_: Demand forecast, sales trend, zero-filled time series

**Trade Trend Summary**:
The first and last recorded-positive observations in a Trade Trend's Finalized Years, their span, exact absolute change, percentage change, and CAGR. It is explicitly unavailable when fewer than two recorded-positive endpoints exist.
_Avoid_: Neutral growth, inferred zero trend, summary including Provisional Year

**Supplier Competition**:
A deterministic five-Finalized-Year view of the complete recorded supplying-economy structure behind one importing economy's imports for one HS Product, pooling recorded trade values across the exact Finalized Years used and reporting each supplying economy's share, bounded cohort membership, and concentration. It is economy-level evidence for investigation, not company identification, a forecast, or a recommendation.
_Avoid_: Buyer-supplier relationship, company-level trade data, inferred zero share

**Supplier Competition Summary / HHI**:
The Herfindahl-Hirschman Index of finalized supplier shares on a documented 0–10,000 scale, computed only when at least one supplying economy recorded a positive pooled value; otherwise concentration is explicitly unavailable rather than a neutral or zero value. It never reflects Provisional Year evidence.
_Avoid_: Market-share estimate for a single company, concentration inferred from missing data, Provisional Year concentration

**Trade Explorer**:
A bounded Analysis Recipe that lets an Export Market Analyst combine only an allowlisted business shape's own fixed dimensions, one grouped dimension, approved measures, finalized-year or code filters, and a deterministic sort, entirely through public semantic vocabulary. It never exposes SQL, storage layout, formulas, unrestricted joins, or raw records, and Provisional Year evidence is excluded by construction.
_Avoid_: Database console, ad hoc query builder, arbitrary pivot table

**Trade Explorer Shape**:
One fixed, versioned business-question template Trade Explorer v1 allowlists -- finalized-year trend, importing markets, supplying economies, or product mix -- naming exactly which single dimension is grouped into result rows and which remaining dimensions must each resolve to one fixed value. A request names a shape rather than freely choosing table-like joins or arbitrary dimension combinations.
_Avoid_: Query template, report type, pivot configuration

**Company Trade Context**:
Separately sourced and access-controlled evidence about Source Party Mentions, Legal Entities, brands, models, transport documents, or shipment events for a Candidate Market Context. It is not BACI evidence and never changes the Candidate Market Score or Data Confidence.
_Avoid_: Company-level BACI, customer list, buyer database

**Source Party Mention**:
A name, address, or identifier recorded for a party on one source record. It is unresolved evidence, not automatically a Legal Entity; Party Roles are separate source-scoped assertions.
_Avoid_: Company, customer, resolved entity

**Legal Entity**:
An independently identifiable party capable of holding legal or contractual responsibility in a jurisdiction. A Source Party Mention may resolve to one, but a particular registry identifier such as an LEI is optional.
_Avoid_: Company name string, required LEI, unresolved party mention

**Legal Entity Relationship**:
A source-attributed assertion connecting Legal Entities under a defined relationship, such as direct accounting-consolidating parent. It is distinct from a Commercial Relationship Assertion.
_Avoid_: Ownership inferred from matching names, buyer-supplier relationship

**Party Role**:
The function a party is recorded as performing on a particular source record, such as buyer, consignee, or consignor. One role does not prove another role or an ongoing commercial relationship.
_Avoid_: Buyer when the source says consignee, supplier when the source says consignor

**Commercial Relationship Assertion**:
A source-attributed or explicitly derived claim that identified parties have a buyer, supplier, or other commercial relationship, including its evidence, method, time scope, and resolution status.
_Avoid_: Inferring buyer or supplier directly from a shipper or consignee label

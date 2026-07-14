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

**Release Revision**:
A difference in same-period BACI evidence between two BACI Releases. It is distinct from change over time within one release.
_Avoid_: Historical growth, year-over-year trend

**Source Freshness Status**:
The checked relationship between the BACI Release currently served and the latest release known to HS Tracker. It does not describe the age, completeness, or immutability of an individual trade year.
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
An immutable published association between an Analysis Recipe version, one reviewed Dataset Package, and compatible discovery catalogs. A running deployment fixes one mapping rather than choosing evidence heuristically.
_Avoid_: Latest-dataset lookup, runtime package selection, mutable recommendation

**Trade Analysis Context**:
The Analysis Recipe, Dataset Package, normalized semantic inputs, and Analysis Identity that establish the reproducible scope of a trade analysis. Candidate Market Context is its Candidate Market-specific form, additionally focused on one Candidate Market.
_Avoid_: Browser session, user project, hidden account state

**Candidate Market Result Export**:
An immutable tabular snapshot of the complete ranked Candidate Market cohort for one export economy and HS Product under explicit analysis, product-catalog, and freshness identities. It carries derived evidence and provenance for follow-up, not raw trade records or company evidence.
_Avoid_: BACI export, raw-data extract, buyer list

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

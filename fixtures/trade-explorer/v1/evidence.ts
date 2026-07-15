import { createHash } from "node:crypto";

import type {
  EconomyIdentity,
  ProductIdentity,
} from "../../../src/domain/candidate-market/result";
import type {
  TradeExplorerCellEvidence,
  TradeExplorerDimension,
  TradeExplorerV1NormalizedInputs,
} from "../../../src/domain/trade-explorer/result";

// Trade Explorer's fixture evidence source is deliberately self-contained
// (like fixtures/trade-trend/v1/evidence.ts and
// fixtures/supplier-competition/v1/evidence.ts): it owns its own small
// economy/product identity registry rather than depending on the separate
// ProductCatalog/EconomyDirectory deep modules (see CONTEXT.md
// "Recommended Dataset Mapping" and issue #32 decision 31). The FIXED
// economy/product codes below ("156"/"528"/"010121"/"851712") intentionally
// reuse the same codes the shared acceptance/demo catalogs already expose,
// so the browser's existing economy/product search controls can select
// them for real.

function economy(
  code: string,
  name: string,
  iso3: string | null,
): EconomyIdentity {
  return { code, name, iso3, identityNote: null };
}

function product(code: string, descriptionEn: string): ProductIdentity {
  return { hsRevision: "HS12", code, descriptionEn };
}

export const TRADE_EXPLORER_ECONOMIES = {
  china: economy("156", "China", "CHN"),
  netherlands: economy("528", "Netherlands", "NLD"),
  mexico: economy("484", "Mexico", "MEX"),
  australia: economy("36", "Australia", "AUS"),
  southAfrica: economy("710", "South Africa", "ZAF"),
  brazil: economy("76", "Brazil", "BRA"),
  canada: economy("124", "Canada", "CAN"),
  usa: economy("842", "United States", "USA"),
  germany: economy("276", "Germany", "DEU"),
} as const;

export const TRADE_EXPLORER_PRODUCTS = {
  horses: product("010121", "Horses: live, pure-bred breeding animals"),
  horsesOther: product(
    "010129",
    "Horses: live, other than pure-bred breeding animals",
  ),
  asses: product("010130", "Asses: live"),
  mules: product("010190", "Mules and hinnies: live"),
  telephones: product(
    "851712",
    "Telephones for cellular networks or for other wireless networks",
  ),
} as const;

const SYNTHETIC_ECONOMY_COHORT: readonly EconomyIdentity[] = Array.from(
  { length: 25 },
  (_, index) => economy(String(index + 1), `Fixture Economy ${index + 1}`, null),
);

const SYNTHETIC_PRODUCT_COHORT: readonly ProductIdentity[] = Array.from(
  { length: 25 },
  (_, index) =>
    product(String(900001 + index), `Fixture HS12 Product ${index + 1}`),
);

const KNOWN_ECONOMIES: ReadonlyMap<string, EconomyIdentity> = new Map(
  [...Object.values(TRADE_EXPLORER_ECONOMIES), ...SYNTHETIC_ECONOMY_COHORT].map(
    (value) => [value.code, value],
  ),
);

const KNOWN_PRODUCTS: ReadonlyMap<string, ProductIdentity> = new Map(
  [...Object.values(TRADE_EXPLORER_PRODUCTS), ...SYNTHETIC_PRODUCT_COHORT].map(
    (value) => [value.code, value],
  ),
);

export function knownTradeExplorerEconomy(code: string): EconomyIdentity | null {
  return KNOWN_ECONOMIES.get(code) ?? null;
}

export function knownTradeExplorerProduct(code: string): ProductIdentity | null {
  return KNOWN_PRODUCTS.get(code) ?? null;
}

function recorded(
  valueCurrentUsd: string,
  sourceFlowCount = 1,
): TradeExplorerCellEvidence {
  return { state: "RECORDED_POSITIVE", valueCurrentUsd, sourceFlowCount };
}
const noFlow: TradeExplorerCellEvidence = { state: "NO_RECORDED_POSITIVE_FLOW" };

// One entry per modeled fixed-dimension combination. Each combination
// declares cells for exactly the grouped-dimension codes the acceptance
// fixture cases request; a known code the combination does not mention
// defaults to MISSING_OBSERVATION (see cellFor below) rather than
// requiring exhaustive per-code authoring, matching the same
// missing-observation-by-default semantics finalized evidence uses
// throughout the platform.
type TradeExplorerFixtureCombo = Readonly<{
  cellsByCode: ReadonlyMap<string, TradeExplorerCellEvidence>;
}>;

const SYNTHETIC_COHORT_CELLS = new Map(
  Array.from({ length: 25 }, (_, index) => [String(index + 1), recorded("1000")]),
);
const SYNTHETIC_PRODUCT_CELLS = new Map(
  Array.from({ length: 25 }, (_, index) => [
    String(900001 + index),
    recorded("1000"),
  ]),
);

// Keyed by [exportEconomy, importEconomy, hsProduct, year].join(":"), with
// "*" standing in for the one grouped axis of that combination's own
// shape (see fixedComboKey in fixture-trade-evidence-source.ts).
const MODELED_COMBOS: ReadonlyMap<string, TradeExplorerFixtureCombo> = new Map([
  [
    "156:528:010121:*",
    {
      cellsByCode: new Map([
        ["2019", recorded("40000")],
        ["2020", recorded("50000")],
        ["2021", noFlow],
        // 2022 intentionally omitted: MISSING_OBSERVATION by default.
        ["2023", recorded("80000")],
      ]),
    },
  ],
  [
    "156:36:010121:*",
    {
      cellsByCode: new Map([
        ["2019", noFlow],
        ["2020", noFlow],
        ["2021", noFlow],
        ["2022", noFlow],
        ["2023", noFlow],
      ]),
    },
  ],
  [
    "156:*:010121:2023",
    {
      cellsByCode: new Map([
        ["528", recorded("160000")],
        ["484", recorded("50000")],
        ["36", noFlow],
        // "710" intentionally omitted: MISSING_OBSERVATION by default.
        ["76", recorded("30000")],
        ["124", recorded("20000")],
        ...SYNTHETIC_COHORT_CELLS,
      ]),
    },
  ],
  [
    "*:528:010121:2023",
    {
      cellsByCode: new Map([
        ["156", recorded("160000")],
        ["76", recorded("20000")],
        ["484", noFlow],
        // "710" intentionally omitted: MISSING_OBSERVATION by default.
        ["124", recorded("15000")],
        ["36", recorded("5000")],
        ...SYNTHETIC_COHORT_CELLS,
      ]),
    },
  ],
  [
    "156:528:*:2023",
    {
      cellsByCode: new Map([
        ["010121", recorded("160000")],
        ["010129", recorded("40000")],
        ["010130", noFlow],
        // "010190" intentionally omitted: MISSING_OBSERVATION by default.
        ["851712", recorded("500000")],
        ...SYNTHETIC_PRODUCT_CELLS,
      ]),
    },
  ],
]);

export function fixedComboKey(
  query: Pick<
    TradeExplorerV1NormalizedInputs,
    "dimension" | "exportEconomy" | "importEconomy" | "hsProduct" | "years"
  >,
): string {
  const part = (dimension: TradeExplorerDimension, value: string): string =>
    query.dimension === dimension ? "*" : value;
  return [
    part("EXPORT_ECONOMY", query.exportEconomy[0] ?? ""),
    part("IMPORT_ECONOMY", query.importEconomy[0] ?? ""),
    part("HS_PRODUCT", query.hsProduct[0] ?? ""),
    part("YEAR", String(query.years[0] ?? "")),
  ].join(":");
}

export function resolveTradeExplorerCombo(
  query: TradeExplorerV1NormalizedInputs,
): TradeExplorerFixtureCombo | null {
  return MODELED_COMBOS.get(fixedComboKey(query)) ?? null;
}

export function cellFor(
  combo: TradeExplorerFixtureCombo,
  code: string,
): TradeExplorerCellEvidence {
  return combo.cellsByCode.get(code) ?? { state: "MISSING_OBSERVATION" };
}

export const TRADE_EXPLORER_FINALIZED_CUTOFF_YEAR = 2023;
export const TRADE_EXPLORER_RELEASE = {
  baciRelease: "V202601",
  sourceUpdateDate: "2026-01-22",
  hsRevision: "HS12" as const,
  ingestedYears: { start: 2012, end: 2024 },
  finalizedCutoffYear: TRADE_EXPLORER_FINALIZED_CUTOFF_YEAR,
  provisionalYear: 2024,
};

// Trade Explorer has no separately published Dataset Package object,
// exactly like Trade Trend/Supplier Competition (see
// recommended-dataset-mapping.ts's RecommendedTradeTrendMappingDeclaration
// comment): it is gated on the SAME already-verified, already-published
// analysis artifact the shared acceptance/current-analysis fixtures use,
// so this artifact identity and analysisReleaseCatalogSha256 intentionally
// match fixtures/acceptance/v1/metadata.ts's ACCEPTANCE_FIXTURE_ARTIFACT /
// ACCEPTANCE_FIXTURE_ANALYSIS_RELEASE_CATALOG_SHA256 exactly (duplicated
// as literals here, matching fixtures/trade-trend/v1/evidence.ts's own
// convention, rather than cross-importing).
export const TRADE_EXPLORER_ANALYSIS_RELEASE_CATALOG_SHA256 =
  "3b1ff899c301d11a2bb5c29e3040e9261a68633b54a7d94f4b15338129d4fcff";

export const TRADE_EXPLORER_ARTIFACT = {
  baciRelease: "V202601",
  buildId: "acceptance-fixtures-v1-core-artifact",
  schemaVersion: "candidate-market-artifact-v1",
  sha256: "038d741a864b684e52a50789f9790a19950b451a68c8b407158abe05e27f4b54",
};

export const TRADE_EXPLORER_FIXTURE_CONTENT_SHA256 = createHash("sha256")
  .update(
    JSON.stringify(
      {
        economies: [...KNOWN_ECONOMIES.entries()],
        products: [...KNOWN_PRODUCTS.entries()],
        modeledCombinations: [...MODELED_COMBOS.entries()],
        release: TRADE_EXPLORER_RELEASE,
        artifact: TRADE_EXPLORER_ARTIFACT,
        analysisReleaseCatalogSha256:
          TRADE_EXPLORER_ANALYSIS_RELEASE_CATALOG_SHA256,
      },
      jsonReplacer,
    ),
  )
  .digest("hex");

function jsonReplacer(_key: string, value: unknown): unknown {
  return value instanceof Map ? [...value.entries()] : value;
}

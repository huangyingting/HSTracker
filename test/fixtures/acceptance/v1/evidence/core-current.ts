import type {
  CmsV1Inputs,
  MarketYearEvidence,
} from "../../../../../src/evidence/trade-evidence-source";
import {
  ACCEPTANCE_FIXTURE_ANALYSIS_RELEASE_CATALOG_SHA256,
  ACCEPTANCE_FIXTURE_ARTIFACT,
  ACCEPTANCE_FIXTURE_BUILD_IDS,
  ACCEPTANCE_FIXTURE_RELEASE,
} from "../metadata";
import { alternativeSuppliersFromShares } from "./alternative-suppliers";

type CandidateDefinition = {
  code: string;
  name: string;
  iso3: string | null;
  identityNote: string | null;
  values: Readonly<Record<number, string | null>>;
  selectedExporterShareBps: number | null;
  alternativeSupplierShares: readonly string[];
};

const candidates: readonly CandidateDefinition[] = [
  {
    code: "36",
    name: "Australia",
    iso3: "AUS",
    identityNote: null,
    values: {
      2019: "2000",
      2020: "2200",
      2021: "2400",
      2022: "2600",
      2023: "2800",
    },
    selectedExporterShareBps: null,
    alternativeSupplierShares: ["0.75", "0.25"],
  },
  {
    code: "76",
    name: "Brazil",
    iso3: "BRA",
    identityNote: null,
    values: {
      2019: "4000",
      2020: "3800",
      2021: "3600",
      2022: "3400",
      2023: "3200",
    },
    selectedExporterShareBps: 1000,
    alternativeSupplierShares: ["0.50", "0.30", "0.20"],
  },
  {
    code: "124",
    name: "Canada",
    iso3: "CAN",
    identityNote: null,
    values: {
      2019: "7000",
      2020: "7000",
      2021: "7000",
      2022: "7000",
      2023: "7000",
    },
    selectedExporterShareBps: 500,
    alternativeSupplierShares: ["0.60", "0.40"],
  },
  {
    code: "152",
    name: "Chile",
    iso3: "CHL",
    identityNote: null,
    values: {
      2019: "3000",
      2020: null,
      2021: "3500",
      2022: "3900",
      2023: "4300",
    },
    selectedExporterShareBps: 2500,
    alternativeSupplierShares: ["0.90", "0.10"],
  },
  {
    code: "392",
    name: "Japan",
    iso3: "JPN",
    identityNote: null,
    values: {
      2019: "7000",
      2020: "7000",
      2021: "7000",
      2022: "7000",
      2023: "7000",
    },
    selectedExporterShareBps: 500,
    alternativeSupplierShares: ["0.60", "0.40"],
  },
  {
    code: "404",
    name: "Kenya",
    iso3: "KEN",
    identityNote: null,
    values: {
      2019: "300",
      2020: "400",
      2021: null,
      2022: null,
      2023: null,
    },
    selectedExporterShareBps: null,
    alternativeSupplierShares: ["1.00"],
  },
  {
    code: "484",
    name: "Mexico",
    iso3: "MEX",
    identityNote: null,
    values: {
      2019: "8000",
      2020: "8500",
      2021: "9000",
      2022: "9500",
      2023: "10000",
    },
    selectedExporterShareBps: 2000,
    alternativeSupplierShares: ["0.40", "0.30", "0.20", "0.10"],
  },
  {
    code: "490",
    name: "Other Asia, nes",
    iso3: null,
    identityNote:
      "BACI code 490 is formally Other Asia, n.e.s.; CEPII documents it as a practical Taiwan proxy.",
    values: {
      2019: "1000",
      2020: "1100",
      2021: "1200",
      2022: "1300",
      2023: "1400",
    },
    selectedExporterShareBps: 1000,
    alternativeSupplierShares: ["0.80", "0.20"],
  },
  {
    code: "528",
    name: "Netherlands",
    iso3: "NLD",
    identityNote: null,
    values: {
      2019: "2000",
      2020: "2600",
      2021: "3400",
      2022: "4500",
      2023: "6000",
    },
    selectedExporterShareBps: 3000,
    alternativeSupplierShares: ["0.25", "0.25", "0.25", "0.25"],
  },
  {
    code: "616",
    name: "Poland",
    iso3: "POL",
    identityNote: null,
    values: {
      2019: "5000",
      2020: "5300",
      2021: "5600",
      2022: "5900",
      2023: "6200",
    },
    selectedExporterShareBps: 1500,
    alternativeSupplierShares: ["0.50", "0.30", "0.20"],
  },
  {
    code: "699",
    name: "India",
    iso3: "IND",
    identityNote: null,
    values: {
      2019: "2000",
      2020: "2500",
      2021: "3200",
      2022: "4000",
      2023: "5000",
    },
    selectedExporterShareBps: null,
    alternativeSupplierShares: ["0.70", "0.20", "0.10"],
  },
  {
    code: "710",
    name: "South Africa",
    iso3: "ZAF",
    identityNote: null,
    values: {
      2019: null,
      2020: null,
      2021: null,
      2022: "1000",
      2023: "1200",
    },
    selectedExporterShareBps: 10000,
    alternativeSupplierShares: [],
  },
  {
    code: "842",
    name: "United States",
    iso3: "USA",
    identityNote: null,
    values: {
      2019: "1500",
      2020: "1800",
      2021: "2200",
      2022: null,
      2023: null,
    },
    selectedExporterShareBps: 2800,
    alternativeSupplierShares: ["0.95", "0.05"],
  },
];

function selectedExporter(
  worldValueKusd: string,
  shareBps: number | null,
): MarketYearEvidence["selectedExporter"] {
  if (shareBps === null) {
    return { state: "NO_RECORDED_POSITIVE_FLOW" };
  }

  const valueKusd = (
    (BigInt(worldValueKusd) * BigInt(shareBps)) /
    10000n
  ).toString();

  return { state: "RECORDED", valueKusd };
}

function marketYear(
  candidate: CandidateDefinition,
  year: number,
  worldValueKusd: string,
  quantityPresentCount?: number,
): MarketYearEvidence {
  const exporter = selectedExporter(
    worldValueKusd,
    candidate.selectedExporterShareBps,
  );
  const sourceFlowCount =
    candidate.alternativeSupplierShares.length +
    (exporter.state === "RECORDED" ? 1 : 0);

  return {
    year,
    candidateMarket: {
      code: candidate.code,
      name: candidate.name,
      iso3: candidate.iso3,
      identityNote: candidate.identityNote,
    },
    worldValueKusd,
    selectedExporter: exporter,
    alternativeSuppliers: alternativeSuppliersFromShares(
      candidate.alternativeSupplierShares,
    ),
    sourceFlowCount,
    quantityPresentCount: quantityPresentCount ?? sourceFlowCount,
  };
}

const mexicoQuantities: Readonly<Record<number, number>> = {
  2019: 4,
  2020: 5,
  2021: 3,
  2022: 5,
  2023: 5,
};

const marketYears = candidates
  .flatMap((candidate) => {
    const rows: MarketYearEvidence[] = [];
    const value2019 = candidate.values[2019];

    if (value2019 !== null) {
      for (let year = 2014; year <= 2018; year += 1) {
        rows.push(marketYear(candidate, year, value2019));
      }
    }

    for (let year = 2019; year <= 2023; year += 1) {
      const value = candidate.values[year];
      if (value !== null) {
        rows.push(
          marketYear(
            candidate,
            year,
            value,
            candidate.code === "484" ? mexicoQuantities[year] : undefined,
          ),
        );
      }
    }

    return rows;
  })
  .sort(
    (left, right) =>
      left.year - right.year ||
      Number(left.candidateMarket.code) - Number(right.candidateMarket.code),
  );

const mexico = candidates.find((candidate) => candidate.code === "484");
const india = candidates.find((candidate) => candidate.code === "699");
const southAfrica = candidates.find((candidate) => candidate.code === "710");

if (mexico === undefined || india === undefined || southAfrica === undefined) {
  throw new Error("Core fixture candidate metadata is incomplete.");
}

const provisionalMarketYears = [
  marketYear(mexico, 2024, "11000", 4),
  marketYear(india, 2024, "6000", 2),
];

export const CORE_CURRENT_INPUT: CmsV1Inputs = {
  analysisBuildId: ACCEPTANCE_FIXTURE_BUILD_IDS.core,
  analysisReleaseCatalogSha256:
    ACCEPTANCE_FIXTURE_ANALYSIS_RELEASE_CATALOG_SHA256,
  artifact: {
    baciRelease: ACCEPTANCE_FIXTURE_RELEASE.baciRelease,
    buildId: "acceptance-fixtures-v1-core-artifact",
    ...ACCEPTANCE_FIXTURE_ARTIFACT,
  },
  release: ACCEPTANCE_FIXTURE_RELEASE,
  exporter: {
    code: "156",
    name: "China",
    iso3: "CHN",
    identityNote: null,
  },
  product: {
    hsRevision: "HS12",
    code: "010121",
    descriptionEn: "Horses: live, pure-bred breeding animals",
  },
  marketYears,
  provisionalMarketYears,
  productYearTotals: [
    { year: 2012, worldValueKusd: "42000" },
    { year: 2013, worldValueKusd: "42400" },
    { year: 2014, worldValueKusd: "42800" },
    { year: 2015, worldValueKusd: "42800" },
    { year: 2016, worldValueKusd: "42800" },
    { year: 2017, worldValueKusd: "42800" },
    { year: 2018, worldValueKusd: "42800" },
    { year: 2019, worldValueKusd: "42800" },
    { year: 2020, worldValueKusd: "42200" },
    { year: 2021, worldValueKusd: "48100" },
    { year: 2022, worldValueKusd: "50100" },
    { year: 2023, worldValueKusd: "54100" },
  ],
};

export const EMPTY_INPUT: CmsV1Inputs = {
  ...CORE_CURRENT_INPUT,
  product: {
    hsRevision: "HS12",
    code: "851712",
    descriptionEn: "Telephones for cellular networks or for other wireless networks",
  },
  marketYears: [],
  provisionalMarketYears: [],
  productYearTotals: [],
};

export const DISCONTINUITY_INPUT: CmsV1Inputs = {
  ...CORE_CURRENT_INPUT,
  analysisBuildId: ACCEPTANCE_FIXTURE_BUILD_IDS.discontinuity,
  product: EMPTY_INPUT.product,
  provisionalMarketYears: [],
  productYearTotals: [
    { year: 2012, worldValueKusd: "10000" },
    { year: 2013, worldValueKusd: "10500" },
    { year: 2014, worldValueKusd: "11000" },
    { year: 2015, worldValueKusd: "11500" },
    { year: 2016, worldValueKusd: "12000" },
    { year: 2017, worldValueKusd: "40000" },
    { year: 2018, worldValueKusd: "41000" },
    { year: 2019, worldValueKusd: "42800" },
    { year: 2020, worldValueKusd: "42200" },
    { year: 2021, worldValueKusd: "48100" },
    { year: 2022, worldValueKusd: "50100" },
    { year: 2023, worldValueKusd: "54100" },
  ],
};

export const QUANTITY_ZERO_INPUT: CmsV1Inputs = {
  ...CORE_CURRENT_INPUT,
  analysisBuildId: ACCEPTANCE_FIXTURE_BUILD_IDS.quantityZero,
  artifact: {
    ...CORE_CURRENT_INPUT.artifact,
    buildId: "acceptance-fixtures-v1-quantity-zero-artifact",
    sha256:
      "7816895ec9a788d361da9b1c77383405d44bdecbd8a38c70f596f184386ab109",
  },
  marketYears: CORE_CURRENT_INPUT.marketYears.map((row) => ({
    ...row,
    quantityPresentCount: 0,
  })),
  provisionalMarketYears: CORE_CURRENT_INPUT.provisionalMarketYears.map(
    (row) => ({
      ...row,
      quantityPresentCount: 0,
    }),
  ),
};

export const PROVISIONAL_MUTATION_INPUT: CmsV1Inputs = {
  ...CORE_CURRENT_INPUT,
  analysisBuildId: ACCEPTANCE_FIXTURE_BUILD_IDS.provisionalMutation,
  artifact: {
    ...CORE_CURRENT_INPUT.artifact,
    buildId: "acceptance-fixtures-v1-provisional-mutation-artifact",
    sha256:
      "bbdc843aed17a15cca68e4ea3df583f909f8143cbd8d6ed2ebba12c8f80c9a5e",
  },
  provisionalMarketYears: [
    marketYear(
      { ...mexico, selectedExporterShareBps: null },
      2024,
      "12000",
      0,
    ),
    marketYear(
      { ...india, selectedExporterShareBps: 1000 },
      2024,
      "6500",
      1,
    ),
    marketYear(southAfrica, 2024, "1300", 0),
  ],
};

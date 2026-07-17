export type Cn8CodeKind =
  | "ORDINARY"
  | "SPECIAL"
  | "CONFIDENTIAL"
  | "RESIDUAL"
  | "TOTAL";

export type CnToHs12CorrespondenceStatus =
  | "EXACT_REVIEWED"
  | "AMBIGUOUS"
  | "SPLIT"
  | "MERGED"
  | "QUALIFIED"
  | "UNMAPPED"
  | "NOT_APPLICABLE";

export type CnToHs12CorrespondenceChain =
  | "DIRECT_EXACT"
  | "MULTI_STEP_EXACT"
  | "NON_EXACT";

export type CnToHs12MappingRejectionReason =
  | "SPECIAL_SOURCE_CODE"
  | "MISSING_CORRESPONDENCE"
  | "NON_EXACT_CORRESPONDENCE"
  | "QUALIFIED_CORRESPONDENCE"
  | "MULTIPLE_TARGETS";

export type CnToHs12MappingEvidence = Readonly<{
  schemaVersion: "cn-to-hs12-mapping-evidence-v1";
  mappingPolicy: "cn-to-hs12-exact-complete-preimage-v1";
  editions: readonly CnToHs12EditionEvidence[];
}>;

export type CnToHs12EditionEvidence = Readonly<{
  cnEditionYear: number;
  cnCodeListSha256: string;
  correspondenceSha256: string;
  reviewId: string;
  cn8Codes: readonly Readonly<{ cn8Code: string; kind: Cn8CodeKind }>[];
  correspondences: readonly CnToHs12CorrespondenceEvidence[];
}>;

export type CnToHs12CorrespondenceEvidence = Readonly<{
  cn8Code: string;
  hs12Code: string;
  status: CnToHs12CorrespondenceStatus;
  chain: CnToHs12CorrespondenceChain;
  qualified?: boolean;
}>;

export type CnToHs12RowMapping = Readonly<{
  cnEditionYear: number;
  cn8Code: string;
  status: CnToHs12CorrespondenceStatus;
  targets: readonly string[];
  chain: CnToHs12CorrespondenceChain;
  rejectionReasons: readonly CnToHs12MappingRejectionReason[];
}>;

export type CnToHs12ProductMapping = Readonly<{
  cnEditionYear: number;
  hs12Code: string;
  productStatus: "EXACT_REVIEWED" | "UNSUPPORTED_PRODUCT_MAPPING";
  acceptedCn8Codes: readonly string[];
  rejectedTouchingCodes: readonly string[];
  correspondenceSha256: string;
  reviewId: string;
  usesMultiStepExactChain: boolean;
}>;

export type CnToHs12MappingReport = Readonly<{
  schemaVersion: "cn-to-hs12-mapping-report-v1";
  mappingPolicy: "cn-to-hs12-exact-complete-preimage-v1";
  rowMappings: readonly CnToHs12RowMapping[];
  productMappings: readonly CnToHs12ProductMapping[];
}>;

export type Hs12ProductAcrossEditionsMapping = Readonly<{
  hs12Code: string;
  status: "EXACT_REVIEWED" | "UNSUPPORTED_PRODUCT_MAPPING";
  acceptedPreimageByEdition: Readonly<Record<number, readonly string[]>>;
  rejectedTouchingCodesByEdition: Readonly<Record<number, readonly string[]>>;
  usesMultiStepExactChain: boolean;
}>;

const SPECIAL_KINDS: ReadonlySet<Cn8CodeKind> = new Set([
  "SPECIAL",
  "CONFIDENTIAL",
  "RESIDUAL",
  "TOTAL",
]);

export function buildCnToHs12MappingReport(
  evidence: CnToHs12MappingEvidence,
): CnToHs12MappingReport {
  if (evidence.schemaVersion !== "cn-to-hs12-mapping-evidence-v1") {
    throw new TypeError("CN-to-HS12 mapping evidence schema is incompatible.");
  }
  if (evidence.mappingPolicy !== "cn-to-hs12-exact-complete-preimage-v1") {
    throw new TypeError("CN-to-HS12 mapping policy is incompatible.");
  }

  const rowMappings: CnToHs12RowMapping[] = [];
  const productMappings: CnToHs12ProductMapping[] = [];

  for (const edition of [...evidence.editions].sort(
    (left, right) => left.cnEditionYear - right.cnEditionYear,
  )) {
    validateEdition(edition);
    const correspondencesByCode = groupBy(
      edition.correspondences,
      (entry) => entry.cn8Code,
    );
    const rowMappingsForEdition: CnToHs12RowMapping[] = [];
    for (const code of [...edition.cn8Codes].sort((left, right) =>
      left.cn8Code.localeCompare(right.cn8Code),
    )) {
      const correspondences = correspondencesByCode.get(code.cn8Code) ?? [];
      const rowMapping = mapCn8Code(
        edition.cnEditionYear,
        code.cn8Code,
        code.kind,
        correspondences,
      );
      rowMappingsForEdition.push(rowMapping);
      rowMappings.push(rowMapping);
    }

    productMappings.push(
      ...buildProductMappingsForEdition(edition, rowMappingsForEdition),
    );
  }

  return {
    schemaVersion: "cn-to-hs12-mapping-report-v1",
    mappingPolicy: "cn-to-hs12-exact-complete-preimage-v1",
    rowMappings,
    productMappings,
  };
}

export function evaluateHs12ProductMappingAcrossEditions(
  report: CnToHs12MappingReport,
  hs12Code: string,
  cnEditionYears: readonly number[],
): Hs12ProductAcrossEditionsMapping {
  const acceptedPreimageByEdition: Record<number, readonly string[]> = {};
  const rejectedTouchingCodesByEdition: Record<number, readonly string[]> = {};
  let status: Hs12ProductAcrossEditionsMapping["status"] = "EXACT_REVIEWED";
  let usesMultiStepExactChain = false;

  for (const year of cnEditionYears) {
    const product = report.productMappings.find(
      (entry) => entry.cnEditionYear === year && entry.hs12Code === hs12Code,
    );
    if (product === undefined || product.productStatus !== "EXACT_REVIEWED") {
      status = "UNSUPPORTED_PRODUCT_MAPPING";
    }
    acceptedPreimageByEdition[year] = product?.acceptedCn8Codes ?? [];
    rejectedTouchingCodesByEdition[year] = product?.rejectedTouchingCodes ?? [];
    usesMultiStepExactChain ||= product?.usesMultiStepExactChain ?? false;
  }

  return {
    hs12Code,
    status,
    acceptedPreimageByEdition,
    rejectedTouchingCodesByEdition,
    usesMultiStepExactChain,
  };
}

function mapCn8Code(
  cnEditionYear: number,
  cn8Code: string,
  kind: Cn8CodeKind,
  correspondences: readonly CnToHs12CorrespondenceEvidence[],
): CnToHs12RowMapping {
  if (SPECIAL_KINDS.has(kind)) {
    return {
      cnEditionYear,
      cn8Code,
      status: "NOT_APPLICABLE",
      targets: [],
      chain: "NON_EXACT",
      rejectionReasons: ["SPECIAL_SOURCE_CODE"],
    };
  }

  const targets = [...new Set(correspondences.map((entry) => entry.hs12Code))].sort();
  const status = summarizeStatus(correspondences);
  const chain = summarizeChain(correspondences);
  const rejectionReasons: CnToHs12MappingRejectionReason[] = [];
  if (correspondences.length === 0) {
    rejectionReasons.push("MISSING_CORRESPONDENCE");
  }
  const hasQualifiedCorrespondence = correspondences.some(
    (entry) => entry.qualified === true || entry.status === "QUALIFIED",
  );
  if (
    !hasQualifiedCorrespondence &&
    correspondences.some(
      (entry) => entry.status !== "EXACT_REVIEWED" || entry.chain === "NON_EXACT",
    )
  ) {
    rejectionReasons.push("NON_EXACT_CORRESPONDENCE");
  }
  if (hasQualifiedCorrespondence) {
    rejectionReasons.push("QUALIFIED_CORRESPONDENCE");
  }
  if (targets.length !== 1) {
    rejectionReasons.push("MULTIPLE_TARGETS");
  }

  return {
    cnEditionYear,
    cn8Code,
    status,
    targets,
    chain,
    rejectionReasons,
  };
}

function buildProductMappingsForEdition(
  edition: CnToHs12EditionEvidence,
  rows: readonly CnToHs12RowMapping[],
): CnToHs12ProductMapping[] {
  const productCodes = [...new Set(rows.flatMap((row) => row.targets))].sort();
  return productCodes.map((hs12Code) => {
    const touching = rows.filter((row) => row.targets.includes(hs12Code));
    const acceptedCn8Codes = touching
      .filter((row) => row.status === "EXACT_REVIEWED" && row.rejectionReasons.length === 0)
      .map((row) => row.cn8Code)
      .sort();
    const rejectedTouchingCodes = touching
      .filter((row) => row.status !== "EXACT_REVIEWED" || row.rejectionReasons.length > 0)
      .map((row) => row.cn8Code)
      .sort();
    return {
      cnEditionYear: edition.cnEditionYear,
      hs12Code,
      productStatus:
        rejectedTouchingCodes.length === 0 && acceptedCn8Codes.length > 0
          ? "EXACT_REVIEWED"
          : "UNSUPPORTED_PRODUCT_MAPPING",
      acceptedCn8Codes,
      rejectedTouchingCodes,
      correspondenceSha256: edition.correspondenceSha256,
      reviewId: edition.reviewId,
      usesMultiStepExactChain: touching.some(
        (row) => row.chain === "MULTI_STEP_EXACT" && row.rejectionReasons.length === 0,
      ),
    };
  });
}

function summarizeStatus(
  correspondences: readonly CnToHs12CorrespondenceEvidence[],
): CnToHs12CorrespondenceStatus {
  if (correspondences.length === 0) {
    return "UNMAPPED";
  }
  const statuses = [...new Set(correspondences.map((entry) => entry.status))];
  if (statuses.length === 1) {
    return statuses[0]!;
  }
  if (statuses.includes("AMBIGUOUS")) {
    return "AMBIGUOUS";
  }
  if (statuses.includes("SPLIT")) {
    return "SPLIT";
  }
  if (statuses.includes("MERGED")) {
    return "MERGED";
  }
  if (statuses.includes("QUALIFIED")) {
    return "QUALIFIED";
  }
  return "UNMAPPED";
}

function summarizeChain(
  correspondences: readonly CnToHs12CorrespondenceEvidence[],
): CnToHs12CorrespondenceChain {
  if (correspondences.length === 0) {
    return "NON_EXACT";
  }
  if (correspondences.some((entry) => entry.chain === "NON_EXACT")) {
    return "NON_EXACT";
  }
  if (correspondences.some((entry) => entry.chain === "MULTI_STEP_EXACT")) {
    return "MULTI_STEP_EXACT";
  }
  return "DIRECT_EXACT";
}

function validateEdition(edition: CnToHs12EditionEvidence): void {
  if (!Number.isSafeInteger(edition.cnEditionYear)) {
    throw new TypeError("CN edition year must be a safe integer.");
  }
  if (!/^[a-f0-9]{64}$/u.test(edition.cnCodeListSha256)) {
    throw new TypeError("CN code-list checksum must be a SHA-256 digest.");
  }
  if (!/^[a-f0-9]{64}$/u.test(edition.correspondenceSha256)) {
    throw new TypeError("CN correspondence checksum must be a SHA-256 digest.");
  }
  const codeSet = new Set<string>();
  for (const code of edition.cn8Codes) {
    if (!/^\d{8}$/u.test(code.cn8Code)) {
      throw new TypeError("CN8 codes must be eight decimal digits.");
    }
    if (codeSet.has(code.cn8Code)) {
      throw new TypeError("CN8 code lists must be unique.");
    }
    codeSet.add(code.cn8Code);
  }
  for (const correspondence of edition.correspondences) {
    if (!codeSet.has(correspondence.cn8Code)) {
      throw new TypeError("CN correspondence references an unknown CN8 code.");
    }
    if (!/^\d{6}$/u.test(correspondence.hs12Code)) {
      throw new TypeError("HS12 targets must be six decimal digits.");
    }
  }
}

function groupBy<Value, Key>(
  values: readonly Value[],
  keyOf: (value: Value) => Key,
): Map<Key, Value[]> {
  const grouped = new Map<Key, Value[]>();
  for (const value of values) {
    const key = keyOf(value);
    const bucket = grouped.get(key);
    if (bucket === undefined) {
      grouped.set(key, [value]);
    } else {
      bucket.push(value);
    }
  }
  return grouped;
}

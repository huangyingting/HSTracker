import { createHash } from "node:crypto";

import type {
  Cn8CodeKind,
  CnToHs12EditionEvidence,
  CnToHs12MappingEvidence,
} from "./cn-to-hs12-mapping";

/**
 * Raw pinned inputs for one CN edition year, exactly as retrieved from the
 * official Eurostat CN classification and the UNSD HS2022-to-HS2012
 * correspondence table. The texts are hashed verbatim so a Dataset Package can
 * pin the mapping evidence it was built from.
 */
export type EurostatCnEditionInput = Readonly<{
  cnEditionYear: number;
  /** Newline-separated eight-digit active CN codes for the edition year. */
  cn8CodeListText: string;
  /** `cn8,hs12` CSV (with header) of exact CN8 to HS 2012 correspondences. */
  correspondenceCsvText: string;
}>;

const SPECIAL_CHAPTERS: ReadonlySet<string> = new Set(["98", "99"]);

/**
 * Build complete-preimage mapping evidence from pinned Eurostat inputs.
 *
 * Every correspondence derived from the official UNSD correlation table is an
 * exact set-partition correspondence, so each row is recorded as
 * `EXACT_REVIEWED`/`DIRECT_EXACT`. Split versus merge behaviour is not asserted
 * here: {@link buildCnToHs12MappingReport} derives exclusivity from target
 * multiplicity, poisoning any HS 2012 product touched by a CN8 code that maps to
 * more than one HS 2012 code. Chapter 98/99 special codes are marked `SPECIAL`
 * so they are excluded from aggregation rather than poisoning products.
 */
export function buildEurostatCnToHs12MappingEvidence(
  editions: readonly EurostatCnEditionInput[],
): CnToHs12MappingEvidence {
  return {
    schemaVersion: "cn-to-hs12-mapping-evidence-v1",
    mappingPolicy: "cn-to-hs12-exact-complete-preimage-v1",
    editions: editions
      .map(buildEditionEvidence)
      .sort((left, right) => left.cnEditionYear - right.cnEditionYear),
  };
}

function buildEditionEvidence(
  input: EurostatCnEditionInput,
): CnToHs12EditionEvidence {
  const cn8Codes = parseCodeList(input.cn8CodeListText).map((cn8Code) => ({
    cn8Code,
    kind: classifyCn8Code(cn8Code),
  }));
  const orderedCodes = new Set(cn8Codes.map((entry) => entry.cn8Code));
  const correspondences = parseCorrespondences(input.correspondenceCsvText).map(
    ({ cn8Code, hs12Code }) => {
      if (!orderedCodes.has(cn8Code)) {
        throw new Error(
          `Correspondence references CN8 ${cn8Code} absent from the ${input.cnEditionYear} code list.`,
        );
      }
      return {
        cn8Code,
        hs12Code,
        status: "EXACT_REVIEWED" as const,
        chain: "DIRECT_EXACT" as const,
      };
    },
  );
  return {
    cnEditionYear: input.cnEditionYear,
    cnCodeListSha256: sha256(input.cn8CodeListText),
    correspondenceSha256: sha256(input.correspondenceCsvText),
    reviewId: `eurostat-cn2022-hs12-${input.cnEditionYear}`,
    cn8Codes,
    correspondences,
  };
}

function classifyCn8Code(cn8Code: string): Cn8CodeKind {
  return SPECIAL_CHAPTERS.has(cn8Code.slice(0, 2)) ? "SPECIAL" : "ORDINARY";
}

function parseCodeList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseCorrespondences(
  text: string,
): { cn8Code: string; hs12Code: string }[] {
  const lines = text.split("\n").map((line) => line.trim());
  const rows: { cn8Code: string; hs12Code: string }[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) {
      continue;
    }
    if (index === 0 && line.toLowerCase().startsWith("cn8")) {
      continue;
    }
    const [cn8Code, hs12Code] = line.split(",");
    if (cn8Code === undefined || hs12Code === undefined) {
      throw new Error(`Malformed correspondence row: ${line}`);
    }
    rows.push({ cn8Code: cn8Code.trim(), hs12Code: hs12Code.trim() });
  }
  return rows;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

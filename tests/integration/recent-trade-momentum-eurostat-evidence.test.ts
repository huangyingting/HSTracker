import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildCnToHs12MappingReport,
  evaluateHs12ProductMappingAcrossEditions,
} from "../../src/domain/recent-trade-momentum/cn-to-hs12-mapping";
import { buildEurostatCnToHs12MappingEvidence } from "../../src/domain/recent-trade-momentum/eurostat-cn-hs12-evidence";

const INPUT_DIR = join(process.cwd(), "data", "recent-trade-momentum", "inputs");
const EDITION_YEARS = [2024, 2025, 2026] as const;

async function loadEvidence() {
  const editions = await Promise.all(
    EDITION_YEARS.map(async (cnEditionYear) => ({
      cnEditionYear,
      cn8CodeListText: await readFile(
        join(INPUT_DIR, `cn8-codes-${cnEditionYear}.txt`),
        "utf8",
      ),
      correspondenceCsvText: await readFile(
        join(INPUT_DIR, `cn8-to-hs2012-${cnEditionYear}.csv`),
        "utf8",
      ),
    })),
  );
  return buildEurostatCnToHs12MappingEvidence(editions);
}

describe("Eurostat CN-to-HS12 mapping evidence", () => {
  it("derives the complete-preimage eligible product universe from pinned inputs", async () => {
    const report = buildCnToHs12MappingReport(await loadEvidence());
    const eligibleProducts = [
      ...new Set(report.productMappings.map((product) => product.hs12Code)),
    ]
      .sort()
      .filter(
        (hs12Code) =>
          evaluateHs12ProductMappingAcrossEditions(report, hs12Code, [
            ...EDITION_YEARS,
          ]).status === "EXACT_REVIEWED",
      );

    // Every eligible HS12 product resolves to at least one CN8 preimage in
    // every edition year without any poisoning touching code.
    expect(eligibleProducts.length).toBe(3830);
  });

  it("accepts a stable one-to-one product and a clean merge", async () => {
    const report = buildCnToHs12MappingReport(await loadEvidence());

    const purebredHorses = evaluateHs12ProductMappingAcrossEditions(
      report,
      "010121",
      [...EDITION_YEARS],
    );
    expect(purebredHorses.status).toBe("EXACT_REVIEWED");
    expect(purebredHorses.acceptedPreimageByEdition[2025]).toEqual(["01012100"]);

    const otherLiveHorses = evaluateHs12ProductMappingAcrossEditions(
      report,
      "010129",
      [...EDITION_YEARS],
    );
    expect(otherLiveHorses.status).toBe("EXACT_REVIEWED");
    expect(otherLiveHorses.acceptedPreimageByEdition[2025]).toEqual([
      "01012910",
      "01012990",
    ]);
  });

  it("poisons a product whose HS2022 preimage was split across HS2012", async () => {
    const report = buildCnToHs12MappingReport(await loadEvidence());

    // Passenger motor cars (8703) were reallocated between HS2012 and HS2022,
    // so at least one touching CN8 code has multiple HS12 targets.
    const passengerCars = evaluateHs12ProductMappingAcrossEditions(
      report,
      "870323",
      [...EDITION_YEARS],
    );
    expect(passengerCars.status).toBe("UNSUPPORTED_PRODUCT_MAPPING");
  });

  it("marks chapter 98/99 special codes as SPECIAL and never maps them", async () => {
    const report = buildCnToHs12MappingReport(await loadEvidence());
    const specialRows = report.rowMappings.filter((row) =>
      row.cn8Code.startsWith("99"),
    );
    expect(specialRows.length).toBeGreaterThan(0);
    for (const row of specialRows) {
      expect(row.status).toBe("NOT_APPLICABLE");
      expect(row.targets).toEqual([]);
    }
  });
});

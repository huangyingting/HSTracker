import { describe, expect, it } from "vitest";

import { MARKET_ANALYSIS_PRODUCT_AREAS } from "../../src/domain/market-analysis/product-areas";
import { MARKET_ANALYSIS_VALIDATION_PLAN_CATEGORIES } from "../../src/domain/market-analysis/validation-plan";
import {
  MARKET_ANALYSIS_COPY,
  MARKET_ANALYSIS_EVIDENCE_STATE_KEYS,
  MARKET_ANALYSIS_LIMITATION_KEYS,
  MARKET_ANALYSIS_RECOVERY_ACTION_KEYS,
} from "../../src/domain/market-analysis/copy";

const LOCALES = ["en", "zh-Hans"] as const;
const VALIDATION_PLAN_CATEGORY_IDS = MARKET_ANALYSIS_VALIDATION_PLAN_CATEGORIES.map(
  (category) => category.id,
);

function groupKeySets(): Readonly<Record<string, readonly string[]>> {
  return {
    productAreas: MARKET_ANALYSIS_PRODUCT_AREAS,
    evidenceStates: MARKET_ANALYSIS_EVIDENCE_STATE_KEYS,
    limitations: MARKET_ANALYSIS_LIMITATION_KEYS,
    recoveryActions: MARKET_ANALYSIS_RECOVERY_ACTION_KEYS,
    validationPlanCategories: VALIDATION_PLAN_CATEGORY_IDS,
    nextActions: VALIDATION_PLAN_CATEGORY_IDS,
  };
}

describe("Market Analysis bilingual copy completeness", () => {
  it.each(LOCALES)(
    "has every product-area, evidence-state, limitation, recovery-action, and Validation Plan copy key for %s",
    (locale) => {
      const messages = MARKET_ANALYSIS_COPY[locale];
      for (const [group, expectedKeys] of Object.entries(groupKeySets())) {
        const actualKeys = Object.keys(
          messages[group as keyof typeof messages],
        );
        expect(actualKeys.sort()).toEqual([...expectedKeys].sort());
      }
    },
  );

  it("gives every copy key a non-empty string in both locales", () => {
    for (const locale of LOCALES) {
      const messages = MARKET_ANALYSIS_COPY[locale];
      for (const group of Object.values(messages)) {
        for (const value of Object.values(group)) {
          expect(typeof value).toBe("string");
          expect((value as string).trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("translates every key instead of duplicating the English placeholder", () => {
    const en = MARKET_ANALYSIS_COPY.en;
    const zh = MARKET_ANALYSIS_COPY["zh-Hans"];
    for (const group of Object.keys(en) as (keyof typeof en)[]) {
      for (const key of Object.keys(en[group])) {
        const enValue = (en[group] as Record<string, string>)[key];
        const zhValue = (zh[group] as Record<string, string>)[key];
        expect(zhValue, `${group}.${key} should be translated`).not.toBe(
          enValue,
        );
      }
    }
  });
});

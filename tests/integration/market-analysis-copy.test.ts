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
const VALIDATION_PLAN_COPY_FIELDS = [
  "label",
  "establishes",
  "cannotEstablish",
  "requiredEvidence",
  "nextAction",
] as const;
const FLAT_COPY_GROUPS = [
  "productAreas",
  "evidenceStates",
  "limitations",
  "recoveryActions",
] as const;

function groupKeySets(): Readonly<Record<string, readonly string[]>> {
  return {
    productAreas: MARKET_ANALYSIS_PRODUCT_AREAS,
    evidenceStates: MARKET_ANALYSIS_EVIDENCE_STATE_KEYS,
    limitations: MARKET_ANALYSIS_LIMITATION_KEYS,
    recoveryActions: MARKET_ANALYSIS_RECOVERY_ACTION_KEYS,
    validationPlanCategories: VALIDATION_PLAN_CATEGORY_IDS,
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
      for (const groupName of FLAT_COPY_GROUPS) {
        for (const value of Object.values(messages[groupName])) {
          expect(typeof value).toBe("string");
          expect(value.trim().length).toBeGreaterThan(0);
        }
      }
      for (const category of Object.values(
        messages.validationPlanCategories,
      )) {
        for (const value of Object.values(category)) {
          expect(value.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("translates every key instead of duplicating the English placeholder", () => {
    const en = MARKET_ANALYSIS_COPY.en;
    const zh = MARKET_ANALYSIS_COPY["zh-Hans"];
    for (const groupName of FLAT_COPY_GROUPS) {
      for (const key of Object.keys(en[groupName])) {
        const enValue = (en[groupName] as Readonly<Record<string, string>>)[
          key
        ];
        const zhValue = (zh[groupName] as Readonly<Record<string, string>>)[
          key
        ];
        expect(
          zhValue,
          `${groupName}.${key} should be translated`,
        ).not.toBe(enValue);
      }
    }
    for (const categoryId of VALIDATION_PLAN_CATEGORY_IDS) {
      const enCategory = en.validationPlanCategories[categoryId];
      const zhCategory = zh.validationPlanCategories[categoryId];
      for (const field of VALIDATION_PLAN_COPY_FIELDS) {
        expect(
          zhCategory[field],
          `validationPlanCategories.${categoryId}.${field} should be translated`,
        ).not.toBe(enCategory[field]);
      }
    }
  });

  it.each(LOCALES)(
    "defines every required Validation Plan statement for %s",
    (locale) => {
      for (const categoryId of VALIDATION_PLAN_CATEGORY_IDS) {
        const category =
          MARKET_ANALYSIS_COPY[locale].validationPlanCategories[categoryId];
        expect(Object.keys(category).sort()).toEqual(
          [...VALIDATION_PLAN_COPY_FIELDS].sort(),
        );
      }
    },
  );
});

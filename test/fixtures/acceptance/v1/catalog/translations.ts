import type { ProductTranslationRecord } from "../../../../../src/catalog/product-catalog";

import { ACCEPTANCE_CAP_PRODUCT_CODES } from "./cap-codes";

const capTranslations: readonly ProductTranslationRecord[] =
  ACCEPTANCE_CAP_PRODUCT_CODES.map((code) => ({
    hsRevision: "HS12",
    code,
    locale: "zh-Hans",
    description: `目录上限测试产品${code.slice(-2)}`,
    translationStatus: "reviewed",
    translationVersion: "acceptance-zh-hans-v1",
  }));

export const ACCEPTANCE_PRODUCT_TRANSLATIONS: readonly ProductTranslationRecord[] =
  [
    {
      hsRevision: "HS12",
      code: "010121",
      locale: "zh-Hans",
      description: "纯种繁殖用活马",
      translationStatus: "reviewed",
      translationVersion: "acceptance-zh-hans-v1",
    },
    {
      hsRevision: "HS12",
      code: "010129",
      locale: "zh-Hans",
      description: "非纯种繁殖用活马",
      translationStatus: "reviewed",
      translationVersion: "acceptance-zh-hans-v1",
    },
    {
      hsRevision: "HS12",
      code: "010130",
      locale: "zh-Hans",
      description: "活驴",
      translationStatus: "reviewed",
      translationVersion: "acceptance-zh-hans-v1",
    },
    {
      hsRevision: "HS12",
      code: "010190",
      locale: "zh-Hans",
      description: "活骡及駃騠",
      translationStatus: "reviewed",
      translationVersion: "acceptance-zh-hans-v1",
    },
    {
      hsRevision: "HS12",
      code: "851712",
      locale: "zh-Hans",
      description: "蜂窝网络或其他无线网络用电话机",
      translationStatus: "reviewed",
      translationVersion: "acceptance-zh-hans-v1",
    },
    ...capTranslations,
  ];

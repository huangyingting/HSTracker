import type { ProductAliasRecord } from "../../../../../src/catalog/product-catalog";

const capAliases: readonly ProductAliasRecord[] = Array.from(
  { length: 21 },
  (_, index) => ({
    hsRevision: "HS12",
    code: `9000${String(index + 1).padStart(2, "0")}`,
    locale: "en",
    alias: "catalog cap",
    reviewStatus: "reviewed",
  }),
);

export const ACCEPTANCE_PRODUCT_ALIASES: readonly ProductAliasRecord[] = [
  {
    hsRevision: "HS12",
    code: "010121",
    locale: "en",
    alias: "purebred horse",
    reviewStatus: "reviewed",
  },
  {
    hsRevision: "HS12",
    code: "010121",
    locale: "en",
    alias: "horse breeding",
    reviewStatus: "reviewed",
  },
  {
    hsRevision: "HS12",
    code: "010121",
    locale: "en",
    alias: "Horses: live, pure-bred breeding animals",
    reviewStatus: "reviewed",
  },
  {
    hsRevision: "HS12",
    code: "010121",
    locale: "en",
    alias: "wireless purebred horse telephone",
    reviewStatus: "reviewed",
  },
  {
    hsRevision: "HS12",
    code: "010121",
    locale: "zh-Hans",
    alias: "马",
    reviewStatus: "reviewed",
  },
  {
    hsRevision: "HS12",
    code: "010129",
    locale: "zh-Hans",
    alias: "马",
    reviewStatus: "reviewed",
  },
  {
    hsRevision: "HS12",
    code: "851712",
    locale: "en",
    alias: "mobile",
    reviewStatus: "reviewed",
  },
  {
    hsRevision: "HS12",
    code: "851712",
    locale: "en",
    alias: "wireless phone",
    reviewStatus: "reviewed",
  },
  {
    hsRevision: "HS12",
    code: "851712",
    locale: "zh-Hans",
    alias: "mobile",
    reviewStatus: "reviewed",
  },
  ...capAliases,
];

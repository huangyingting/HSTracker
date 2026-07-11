import type { ProductCatalogRecord } from "../../../../../src/catalog/product-catalog";

const capProducts: readonly ProductCatalogRecord[] = Array.from(
  { length: 21 },
  (_, index) => {
    const suffix = String(index + 1).padStart(2, "0");
    return {
      hsRevision: "HS12",
      code: `9000${suffix}`,
      sourceDescriptionEn: `Fixture catalog cap product ${suffix}`,
    };
  },
);

export const ACCEPTANCE_PRODUCT_RECORDS: readonly ProductCatalogRecord[] = [
  {
    hsRevision: "HS12",
    code: "010121",
    sourceDescriptionEn: "Horses: live, pure-bred breeding animals",
  },
  {
    hsRevision: "HS12",
    code: "010129",
    sourceDescriptionEn:
      "Horses: live, other than pure-bred breeding animals",
  },
  {
    hsRevision: "HS12",
    code: "010130",
    sourceDescriptionEn: "Asses: live",
  },
  {
    hsRevision: "HS12",
    code: "010190",
    sourceDescriptionEn: "Mules and hinnies: live",
  },
  {
    hsRevision: "HS12",
    code: "851712",
    sourceDescriptionEn:
      "Telephones for cellular networks or for other wireless networks",
  },
  ...capProducts,
];

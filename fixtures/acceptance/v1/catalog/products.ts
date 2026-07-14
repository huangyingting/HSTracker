import type { ProductCatalogRecord } from "../../../../src/catalog/product-catalog";

import { ACCEPTANCE_CAP_PRODUCT_CODES } from "./cap-codes";

const capProducts: readonly ProductCatalogRecord[] =
  ACCEPTANCE_CAP_PRODUCT_CODES.map((code) => ({
    hsRevision: "HS12",
    code,
    sourceDescriptionEn: `Fixture catalog cap product ${code.slice(-2)}`,
  }));

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

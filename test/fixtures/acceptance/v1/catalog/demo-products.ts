import type {
  ProductAliasRecord,
  ProductCatalogRecord,
  ProductTranslationRecord,
} from "../../../../../src/catalog/product-catalog";

/**
 * Recognizable real HS12 products used to make the fixture (development and
 * end-to-end) runtime a useful exploration surface. Descriptions are the exact
 * CEPII BACI HS12 source descriptions. Each product carries at least one
 * common-language alias so everyday search terms (for example "computer" or
 * "television") resolve, mirroring the curated alias coverage the production
 * catalog builds from `data/catalog/inputs/baci-hs12-reviewed-aliases-v1.json`.
 */
type DemoProduct = {
  code: string;
  sourceDescriptionEn: string;
  auxiliaryDescriptionZhHans: string;
  aliases: readonly {
    locale: "en" | "zh-Hans";
    alias: string;
  }[];
};

const DEMO_PRODUCTS: readonly DemoProduct[] = [
  {
    code: "847130",
    sourceDescriptionEn:
      "Automatic data processing machines: portable, weighing not more than 10kg, consisting of at least a central processing unit, a keyboard and a display",
    auxiliaryDescriptionZhHans:
      "便携式自动数据处理设备：重量不超过10千克，至少包含中央处理器、键盘和显示器",
    aliases: [
      { locale: "en", alias: "laptop" },
      { locale: "en", alias: "computer" },
      { locale: "zh-Hans", alias: "电脑" },
    ],
  },
  {
    code: "851762",
    sourceDescriptionEn:
      "Communication apparatus (excluding telephone sets or base stations): machines for the reception, conversion and transmission or regeneration of voice, images or other data, including switching and routing apparatus",
    auxiliaryDescriptionZhHans:
      "通信设备（电话机或基站除外）：用于接收、转换、传输或再生语音、图像或其他数据的设备，包括交换和路由设备",
    aliases: [
      { locale: "en", alias: "router" },
      { locale: "en", alias: "network switch" },
    ],
  },
  {
    code: "852872",
    sourceDescriptionEn:
      "Reception apparatus for television, whether or not incorporating radio-broadcast receivers or sound or video recording or reproducing apparatus: incorporating a colour video display or screen",
    auxiliaryDescriptionZhHans:
      "电视接收设备：带彩色视频显示屏，不论是否装有收音机或声音、图像录制或重放装置",
    aliases: [
      { locale: "en", alias: "television" },
      { locale: "en", alias: "tv" },
      { locale: "zh-Hans", alias: "电视" },
    ],
  },
  {
    code: "870323",
    sourceDescriptionEn:
      "Vehicles: spark-ignition internal combustion reciprocating piston engine, cylinder capacity exceeding 1500cc but not exceeding 3000cc",
    auxiliaryDescriptionZhHans:
      "载客汽车：装有点燃式内燃往复活塞发动机，排量超过1500cc但不超过3000cc",
    aliases: [
      { locale: "en", alias: "car" },
      { locale: "en", alias: "automobile" },
      { locale: "zh-Hans", alias: "汽车" },
    ],
  },
  {
    code: "871200",
    sourceDescriptionEn:
      "Bicycles and other cycles: including delivery tricycles, not motorised",
    auxiliaryDescriptionZhHans: "自行车及其他非机动脚踏车：包括运货三轮车",
    aliases: [
      { locale: "en", alias: "bicycle" },
      { locale: "en", alias: "bike" },
    ],
  },
  {
    code: "401110",
    sourceDescriptionEn:
      "Rubber: new pneumatic tyres, of a kind used on motor cars (including station wagons and racing cars)",
    auxiliaryDescriptionZhHans:
      "橡胶：新充气轮胎，用于小客车（包括旅行车和赛车）",
    aliases: [
      { locale: "en", alias: "car tyre" },
      { locale: "en", alias: "tire" },
    ],
  },
  {
    code: "300490",
    sourceDescriptionEn:
      "Medicaments: consisting of mixed or unmixed products n.e.c. in heading no. 3004, for therapeutic or prophylactic uses, packaged for retail sale",
    auxiliaryDescriptionZhHans:
      "药品：由混合或非混合产品构成，供治疗或预防用途，零售包装",
    aliases: [
      { locale: "en", alias: "medicine" },
      { locale: "en", alias: "medicament" },
    ],
  },
  {
    code: "610910",
    sourceDescriptionEn:
      "T-shirts, singlets and other vests: of cotton, knitted or crocheted",
    auxiliaryDescriptionZhHans: "棉制针织或钩编T恤衫、汗衫及其他背心",
    aliases: [
      { locale: "en", alias: "t-shirt" },
      { locale: "en", alias: "tshirt" },
    ],
  },
  {
    code: "090111",
    sourceDescriptionEn: "Coffee: not roasted or decaffeinated",
    auxiliaryDescriptionZhHans: "咖啡：未焙炒、未脱去咖啡因",
    aliases: [
      { locale: "en", alias: "green coffee" },
      { locale: "en", alias: "coffee beans" },
      { locale: "zh-Hans", alias: "咖啡" },
    ],
  },
  {
    code: "220421",
    sourceDescriptionEn:
      "Wine: still, in containers holding 2 litres or less",
    auxiliaryDescriptionZhHans: "葡萄酒：静止葡萄酒，装于2升及以下容器",
    aliases: [
      { locale: "en", alias: "wine" },
      { locale: "zh-Hans", alias: "葡萄酒" },
    ],
  },
  {
    code: "180690",
    sourceDescriptionEn:
      "Chocolate and other food preparations containing cocoa: n.e.c. in chapter 18",
    auxiliaryDescriptionZhHans: "巧克力及其他含可可的食品：章18中未列名的",
    aliases: [{ locale: "en", alias: "chocolate" }],
  },
  {
    code: "940360",
    sourceDescriptionEn:
      "Furniture: wooden, other than for office, kitchen or bedroom use",
    auxiliaryDescriptionZhHans: "家具：木制，办公室、厨房或卧室用除外",
    aliases: [{ locale: "en", alias: "furniture" }],
  },
  {
    code: "950450",
    sourceDescriptionEn:
      "Games: video game consoles and machines, other than those of subheading 9504.30",
    auxiliaryDescriptionZhHans: "游戏机：电子游戏机，子目9504.30的产品除外",
    aliases: [
      { locale: "en", alias: "game console" },
      { locale: "en", alias: "video game console" },
    ],
  },
  {
    code: "420221",
    sourceDescriptionEn:
      "Cases and containers: handbags (whether or not with shoulder strap and including those without handle), with outer surface of leather or of composition leather",
    auxiliaryDescriptionZhHans:
      "箱包：手提包（不论是否带肩带，包括无提手的），外表面为皮革或再生皮革",
    aliases: [
      { locale: "en", alias: "handbag" },
      { locale: "en", alias: "leather bag" },
    ],
  },
  {
    code: "330300",
    sourceDescriptionEn: "Perfumes and toilet waters",
    auxiliaryDescriptionZhHans: "香水及花露水",
    aliases: [{ locale: "en", alias: "perfume" }],
  },
];

export const DEMO_PRODUCT_CODES: ReadonlySet<string> = new Set(
  DEMO_PRODUCTS.map((product) => product.code),
);

export const DEMO_PRODUCT_RECORDS: readonly ProductCatalogRecord[] =
  DEMO_PRODUCTS.map((product) => ({
    hsRevision: "HS12",
    code: product.code,
    sourceDescriptionEn: product.sourceDescriptionEn,
  }));

export const DEMO_PRODUCT_TRANSLATIONS: readonly ProductTranslationRecord[] =
  DEMO_PRODUCTS.map((product) => ({
    hsRevision: "HS12",
    code: product.code,
    locale: "zh-Hans",
    description: product.auxiliaryDescriptionZhHans,
    translationStatus: "reviewed",
    translationVersion: "acceptance-zh-hans-v1",
  }));

export const DEMO_PRODUCT_ALIASES: readonly ProductAliasRecord[] =
  DEMO_PRODUCTS.flatMap((product) =>
    product.aliases.map((alias) => ({
      hsRevision: "HS12" as const,
      code: product.code,
      locale: alias.locale,
      alias: alias.alias,
      reviewStatus: "reviewed" as const,
    })),
  );

export type ReviewedMonthlyReporter =
  | Readonly<{
      state: "REVIEWED";
      iso3: string;
      iso2: string;
    }>
  | Readonly<{
      state: "UNSUPPORTED_MARKET";
      iso3: string | null;
    }>;

const REVIEWED_REPORTER_ISO2_BY_ISO3: Readonly<Record<string, string>> =
  Object.freeze({
    AUS: "AU",
    BEL: "BE",
    BRA: "BR",
    CAN: "CA",
    CHL: "CL",
    DEU: "DE",
    FRA: "FR",
    IND: "IN",
    JPN: "JP",
    KEN: "KE",
    MEX: "MX",
    NLD: "NL",
    POL: "PL",
    USA: "US",
    ZAF: "ZA",
  });

export function resolveReviewedMonthlyReporter(
  iso3: string | null,
): ReviewedMonthlyReporter {
  const iso2 =
    iso3 === null ? undefined : REVIEWED_REPORTER_ISO2_BY_ISO3[iso3];
  return iso3 !== null && iso2 !== undefined
    ? { state: "REVIEWED", iso3, iso2 }
    : { state: "UNSUPPORTED_MARKET", iso3 };
}

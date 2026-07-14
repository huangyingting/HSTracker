import type { EconomyRecord } from "../../../../src/economy/economy-directory";

export const ACCEPTANCE_ECONOMY_CAP_RECORDS: readonly EconomyRecord[] =
  Array.from({ length: 51 }, (_, index) => {
    const code = String(900 + index);
    return {
      code,
      iso2: null,
      iso3: null,
      name: `Fixture Economy ${code}`,
      identityNote: "Synthetic cap fixture; not a BACI economy identity.",
    };
  });

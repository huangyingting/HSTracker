import { describe, expect, it } from "vitest";

import { readNullableIso3Crosswalk } from "../../src/economy/iso3-crosswalk";

describe("economy ISO3 crosswalk", () => {
  it("preserves ISO3 values and treats source special codes as missing", () => {
    expect(readNullableIso3Crosswalk("USA", "economy iso3")).toBe("USA");
    expect(readNullableIso3Crosswalk(null, "economy iso3")).toBeNull();
    expect(
      ["S19", "R20", "ZA1"].map((value) =>
        readNullableIso3Crosswalk(value, "economy iso3"),
      ),
    ).toEqual([null, null, null]);
  });

  it.each(["US", "usa", "", "U-A"])(
    "rejects malformed crosswalk value %j",
    (value) => {
      expect(() =>
        readNullableIso3Crosswalk(value, "economy iso3"),
      ).toThrow(/economy iso3/u);
    },
  );
});

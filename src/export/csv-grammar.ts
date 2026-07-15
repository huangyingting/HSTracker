// Shared, byte-identical CSV formula-injection and encoding grammar reused by
// both src/export/candidate-market-csv.ts and src/export/trade-trend-csv.ts.
// Candidate Market's exact CSV bytes are locked, so this module only
// contains the two recipes' fully identical low-level helpers -- never the
// per-recipe CSV_SCHEMA, cell-kind pattern tables, or row-building logic,
// which differ between the two exports and stay in their own files.

export function encodeCsvRecord(values: readonly string[]): string {
  return values.map((value) => `"${value.replaceAll('"', '""')}"`).join(",");
}

export function protectHumanText<Column extends string>(
  value: string,
  column: Column,
  escapedColumns: Set<Column>,
): string {
  let inspectedIndex = 0;
  while (
    inspectedIndex < value.length &&
    value[inspectedIndex] !== "\t" &&
    value[inspectedIndex] !== "\r" &&
    value[inspectedIndex] !== "\n" &&
    /\p{White_Space}/u.test(value[inspectedIndex]!)
  ) {
    inspectedIndex += 1;
  }
  const trigger = value[inspectedIndex];

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const allowedLeadingTrigger =
      index === inspectedIndex &&
      (value[index] === "\t" ||
        value[index] === "\r" ||
        value[index] === "\n");
    if (code === 0x7f || (code < 0x20 && !allowedLeadingTrigger)) {
      throw new TypeError(
        `CSV human-text column ${column} contains a forbidden control character.`,
      );
    }
  }

  if (
    trigger !== undefined &&
    ["=", "+", "-", "@", "\t", "\r", "\n", "＝", "＋", "－", "＠"].includes(
      trigger,
    )
  ) {
    escapedColumns.add(column);
    return `'${value}`;
  }
  return value;
}

export function productTranslationStatus(
  status: "fallback-english" | "machine-assisted" | "reviewed",
): "FALLBACK_ENGLISH" | "MACHINE_ASSISTED" | "REVIEWED" {
  if (status === "fallback-english") {
    return "FALLBACK_ENGLISH";
  }
  return status === "machine-assisted" ? "MACHINE_ASSISTED" : "REVIEWED";
}

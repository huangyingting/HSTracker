export const ACCEPTANCE_CAP_PRODUCT_CODES: readonly string[] = Array.from(
  { length: 21 },
  (_, index) => `9000${String(index + 1).padStart(2, "0")}`,
);

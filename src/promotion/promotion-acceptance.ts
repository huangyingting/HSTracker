import { readFile } from "node:fs/promises";

import { verifyRetainedPromotionEvidence } from "./promotion-evidence";
import {
  evaluatePromotionReport,
  parsePromotionReportInput,
} from "./promotion-report";

const MAX_PROMOTION_INPUT_BYTES = 8 * 1024 ** 2;

export class PromotionAcceptanceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PromotionAcceptanceError";
  }
}

export async function loadPromotionEvaluation(
  inputPath: string,
  repositoryRoot: string,
) {
  const inputBytes = await readFile(inputPath);
  if (inputBytes.byteLength > MAX_PROMOTION_INPUT_BYTES) {
    throw new PromotionAcceptanceError(
      "PROMOTION_INPUT_OVERSIZED",
      "Promotion input exceeds 8 MiB.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(inputBytes.toString("utf8")) as unknown;
  } catch {
    throw new PromotionAcceptanceError(
      "PROMOTION_INPUT_INVALID",
      "Promotion input is not valid JSON.",
    );
  }
  const input = parsePromotionReportInput(value);
  const report = evaluatePromotionReport(input);
  const retainedEvidence = await verifyRetainedPromotionEvidence(
    input.evidence,
    repositoryRoot,
  );
  return { input, report, retainedEvidence };
}

export async function loadAcceptedPromotion(
  inputPath: string,
  repositoryRoot: string,
) {
  const evaluation = await loadPromotionEvaluation(
    inputPath,
    repositoryRoot,
  );
  if (evaluation.report.status !== "accepted") {
    throw new PromotionAcceptanceError(
      "PROMOTION_NOT_ACCEPTED",
      "Release activation requires an accepted production promotion report.",
    );
  }
  return evaluation;
}

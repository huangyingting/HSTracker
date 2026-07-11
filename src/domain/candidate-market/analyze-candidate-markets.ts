import { invalidAnalysisQuery } from "./errors";
import { computeCmsV1 } from "./cms-v1";
import type {
  CandidateMarketAnalysisQuery,
  CandidateMarketResult,
} from "./result";
import type { TradeEvidenceSource } from "../../evidence/trade-evidence-source";

export interface CandidateMarketAnalysis {
  analyze(query: CandidateMarketAnalysisQuery): Promise<CandidateMarketResult>;
}

export class CmsV1CandidateMarketAnalysis implements CandidateMarketAnalysis {
  constructor(private readonly evidenceSource: TradeEvidenceSource) {}

  async analyze(
    query: CandidateMarketAnalysisQuery,
  ): Promise<CandidateMarketResult> {
    validateQuery(query);
    const inputs = await this.evidenceSource.loadCmsV1Inputs(query);
    return computeCmsV1(inputs);
  }
}

function validateQuery(query: CandidateMarketAnalysisQuery) {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/i.test(query.analysisBuildId)) {
    throw invalidAnalysisQuery("analysisBuildId is malformed.");
  }

  if (!/^[0-9]{1,3}$/.test(query.exporterCode)) {
    throw invalidAnalysisQuery("exporterCode must be a BACI economy code.");
  }

  if (!/^[0-9]{6}$/.test(query.productCode)) {
    throw invalidAnalysisQuery(
      "productCode must contain exactly six ASCII digits.",
    );
  }
}

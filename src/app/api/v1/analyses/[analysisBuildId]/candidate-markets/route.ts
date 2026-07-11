import { createHash, randomUUID } from "node:crypto";

import { createFixtureCandidateMarketAnalysis } from "../../../../../../evidence/fixture-trade-evidence-source";
import {
  CandidateMarketAnalysisError,
  invalidAnalysisQuery,
} from "../../../../../../domain/candidate-market/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const analysis = createFixtureCandidateMarketAnalysis();
const IMMUTABLE_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable";

type CandidateMarketRouteContext = {
  params: Promise<{
    analysisBuildId: string;
  }>;
};

export async function GET(
  request: Request,
  context: CandidateMarketRouteContext,
): Promise<Response> {
  return respond(request, context, false);
}

export async function HEAD(
  request: Request,
  context: CandidateMarketRouteContext,
): Promise<Response> {
  return respond(request, context, true);
}

async function respond(
  request: Request,
  context: CandidateMarketRouteContext,
  headOnly: boolean,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    validateSearchParameters(url.searchParams);
    const { analysisBuildId } = await context.params;
    const result = await analysis.analyze({
      analysisBuildId,
      exporterCode: url.searchParams.get("exporter") ?? "",
      productCode: url.searchParams.get("product") ?? "",
    });
    const body = JSON.stringify(result);
    const etag = `W/"${createHash("sha256").update(body).digest("hex")}"`;
    const headers = {
      "Cache-Control": IMMUTABLE_CACHE_CONTROL,
      "Content-Type": "application/json; charset=utf-8",
      ETag: etag,
      Vary: "Accept-Encoding",
    };

    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(headOnly ? null : body, {
      status: 200,
      headers,
    });
  } catch (error) {
    if (error instanceof CandidateMarketAnalysisError) {
      return errorResponse(
        error.status,
        error.code,
        error.publicMessage,
      );
    }

    const correlationId = randomUUID();
    console.error("Candidate Market analysis request failed", {
      correlationId,
      error,
    });
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Candidate Market analysis could not be completed.",
      correlationId,
    );
  }
}

function validateSearchParameters(searchParameters: URLSearchParams) {
  const keys = [...searchParameters.keys()];
  if (
    keys.length !== 2 ||
    searchParameters.getAll("exporter").length !== 1 ||
    searchParameters.getAll("product").length !== 1 ||
    keys.some((key) => key !== "exporter" && key !== "product")
  ) {
    throw invalidAnalysisQuery(
      "The route accepts exactly one exporter and one product parameter.",
    );
  }
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  correlationId?: string,
): Response {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message,
        ...(correlationId === undefined ? {} : { correlationId }),
      },
    }),
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );
}

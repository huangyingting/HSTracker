import { createHash, randomUUID } from "node:crypto";

import {
  invalidEconomyQuery,
  isEconomyDirectoryError,
} from "../../../../../../economy/economy-directory-errors";
import { getApplicationRuntime } from "../../../../../../runtime/application-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMMUTABLE_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable";

type EconomyRouteContext = {
  params: Promise<{
    analysisBuildId: string;
  }>;
};

export async function GET(
  request: Request,
  context: EconomyRouteContext,
): Promise<Response> {
  return respond(request, context, false);
}

export async function HEAD(
  request: Request,
  context: EconomyRouteContext,
): Promise<Response> {
  return respond(request, context, true);
}

async function respond(
  request: Request,
  context: EconomyRouteContext,
  headOnly: boolean,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const query = parseSearchParameters(url.searchParams);
    const { analysisBuildId } = await context.params;
    const result = await getApplicationRuntime().searchEconomies({
      analysisBuildId,
      query,
      limit: 50,
    });
    const body = JSON.stringify(result);
    const etag = `W/"${createHash("sha256").update(body).digest("hex")}"`;
    const headers = {
      "Cache-Control": IMMUTABLE_CACHE_CONTROL,
      "Content-Type": "application/json; charset=utf-8",
      ETag: etag,
      Vary: "Accept-Encoding",
    };

    if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(headOnly ? null : body, {
      status: 200,
      headers,
    });
  } catch (error) {
    if (isEconomyDirectoryError(error)) {
      return errorResponse(
        error.status,
        error.code,
        error.publicMessage,
      );
    }

    const correlationId = randomUUID();
    console.error("Economy Directory request failed", {
      correlationId,
      error,
    });
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Economy search could not be completed.",
      correlationId,
    );
  }
}

function parseSearchParameters(searchParameters: URLSearchParams): string {
  const keys = [...searchParameters.keys()];
  const query = searchParameters.get("q");
  if (
    keys.length !== 1 ||
    searchParameters.getAll("q").length !== 1 ||
    keys.some((key) => key !== "q") ||
    query === null
  ) {
    throw invalidEconomyQuery(
      "The route accepts exactly one q parameter.",
    );
  }
  return query;
}

function matchesIfNoneMatch(
  ifNoneMatch: string | null,
  representationEtag: string,
): boolean {
  if (ifNoneMatch === null) {
    return false;
  }
  if (ifNoneMatch.trim() === "*") {
    return true;
  }
  const target = /^(?:W\/)?"([^"]*)"$/u.exec(representationEtag)?.[1];
  return (
    target !== undefined &&
    [
      ...ifNoneMatch.matchAll(
        /(?:^|,)\s*(?:W\/)?"([^"]*)"\s*(?=,|$)/gu,
      ),
    ].some((match) => match[1] === target)
  );
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

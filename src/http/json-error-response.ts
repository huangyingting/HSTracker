export function jsonErrorResponse(
  status: number,
  code: string,
  message: string,
  correlationId?: string,
  additionalHeaders: Record<string, string> = {},
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
        ...additionalHeaders,
      },
    },
  );
}

export function jsonErrorResponseFor(
  error: {
    status: number;
    code: string;
    publicMessage: string;
  },
  correlationId?: string,
  additionalHeaders?: Record<string, string>,
): Response {
  return jsonErrorResponse(
    error.status,
    error.code,
    error.publicMessage,
    correlationId,
    additionalHeaders,
  );
}

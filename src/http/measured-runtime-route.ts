import {
  getApplicationRuntime,
  type ApplicationRuntime,
} from "../runtime/application-runtime";
import {
  createRequestDeadline,
  isRequestDeadlineExceededError,
} from "../runtime/request-deadline";
import {
  classifyRuntimeRequest,
  measureRuntimeRequest,
  type RuntimeRequestMeasurement,
  type RuntimeRouteFamily,
} from "../runtime/runtime-metrics";
import { jsonErrorResponseFor } from "./json-error-response";
import { withoutResponseBody } from "./response";

type MeasuredRuntimeRouteContext<Context> = Readonly<{
  request: Request;
  context: Context;
  runtime: ApplicationRuntime;
  signal: AbortSignal;
  measurement: RuntimeRequestMeasurement;
}>;

type MeasuredRuntimeRouteConfig<Context> = Readonly<{
  routeFamily: RuntimeRouteFamily;
  deadlineMs: number;
  respond(
    context: MeasuredRuntimeRouteContext<Context>,
  ): Promise<Response>;
  errorResponse(
    error: unknown,
    measurement: RuntimeRequestMeasurement,
  ): Response;
}>;

export function createMeasuredRuntimeRoute<Context>(
  config: MeasuredRuntimeRouteConfig<Context>,
): {
  get(request: Request, context: Context): Promise<Response>;
  head(request: Request, context: Context): Promise<Response>;
} {
  async function respond(
    request: Request,
    context: Context,
    headOnly: boolean,
  ): Promise<Response> {
    const runtime = getApplicationRuntime();
    return measureRuntimeRequest(
      runtime,
      config.routeFamily,
      classifyRuntimeRequest(request, headOnly ? "HEAD" : "GET"),
      async (measurement) => {
        const deadline = createRequestDeadline(
          request.signal,
          config.deadlineMs,
        );
        try {
          const response = await config.respond({
            request,
            context,
            runtime,
            signal: deadline.signal,
            measurement,
          });
          return headOnly ? withoutResponseBody(response) : response;
        } catch (error) {
          const response = isRequestDeadlineExceededError(error)
            ? jsonErrorResponseFor(error)
            : config.errorResponse(error, measurement);
          return headOnly ? withoutResponseBody(response) : response;
        } finally {
          deadline.dispose();
        }
      },
    );
  }

  return {
    get: (request, context) => respond(request, context, false),
    head: (request, context) => respond(request, context, true),
  };
}

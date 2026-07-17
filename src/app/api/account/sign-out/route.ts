import {
  accountRouteErrorResponse,
  clearSessionCookieHeader,
  emptyResponse,
  requireSession,
} from "../account-route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireSession(request);
    if (session instanceof Response) {
      return emptyResponse(204, {
        "Set-Cookie": clearSessionCookieHeader(),
      });
    }
    await session.service.signOut(session.sessionToken);
    return emptyResponse(204, {
      "Set-Cookie": clearSessionCookieHeader(),
    });
  } catch (error) {
    return accountRouteErrorResponse(error);
  }
}

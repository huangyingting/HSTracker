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
      return session;
    }
    await session.service.deleteAccount(session.account.id);
    return emptyResponse(204, {
      "Set-Cookie": clearSessionCookieHeader(),
    });
  } catch (error) {
    return accountRouteErrorResponse(error);
  }
}

import {
  accountPayload,
  accountRouteErrorResponse,
  jsonResponse,
  requireSession,
} from "../../account-route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await requireSession(request);
    if (session instanceof Response) {
      return session;
    }
    return jsonResponse(await accountPayload(session.service, session.account));
  } catch (error) {
    return accountRouteErrorResponse(error);
  }
}

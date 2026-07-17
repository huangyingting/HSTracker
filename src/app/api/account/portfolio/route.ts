import {
  accountRouteErrorResponse,
  jsonResponse,
  requireSession,
} from "../account-route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await requireSession(request);
    if (session instanceof Response) {
      return session;
    }
    return jsonResponse({
      portfolio: await session.service.listConfirmedProducts(session.account.id),
    });
  } catch (error) {
    return accountRouteErrorResponse(error);
  }
}

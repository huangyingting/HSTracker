import {
  accountPayload,
  accountRouteErrorResponse,
  jsonResponse,
  readJsonObject,
  requireSession,
  stringField,
} from "../account-route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireSession(request);
    if (session instanceof Response) {
      return session;
    }
    const body = await readJsonObject(request);
    const account = await session.service.setPrimaryExporter(
      session.account.id,
      stringField(body, "primaryExportEconomy"),
    );
    return jsonResponse(await accountPayload(session.service, account));
  } catch (error) {
    return accountRouteErrorResponse(error);
  }
}

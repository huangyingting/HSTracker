import {
  accountRouteErrorResponse,
  jsonResponse,
  readJsonObject,
  requireSession,
  stringField,
} from "../../account-route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireSession(request);
    if (session instanceof Response) {
      return session;
    }
    const body = await readJsonObject(request);
    return jsonResponse({
      portfolio: await session.service.removeProduct(session.account.id, {
        hsRevision: stringField(body, "hsRevision"),
        code: stringField(body, "code"),
      }),
    });
  } catch (error) {
    return accountRouteErrorResponse(error);
  }
}

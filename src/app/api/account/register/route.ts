import {
  accountPayload,
  accountRouteErrorResponse,
  jsonResponse,
  readJsonObject,
  sessionCookieHeader,
  stringField,
} from "../account-route-helpers";
import { getAccountService } from "../../../../runtime/account-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonObject(request);
    const service = await getAccountService();
    await service.registerAccount({
      email: stringField(body, "email"),
      password: stringField(body, "password"),
      displayName: stringField(body, "displayName"),
      primaryExportEconomy: stringField(body, "primaryExportEconomy"),
    });
    const session = await service.authenticate({
      email: stringField(body, "email"),
      password: stringField(body, "password"),
    });
    return jsonResponse(await accountPayload(service, session.account), {
      status: 201,
      headers: {
        "Set-Cookie": sessionCookieHeader(
          session.sessionToken,
          session.expiresAt,
        ),
      },
    });
  } catch (error) {
    return accountRouteErrorResponse(error);
  }
}

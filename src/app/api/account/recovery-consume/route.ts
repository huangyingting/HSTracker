import {
  accountRouteErrorResponse,
  jsonResponse,
  readJsonObject,
  stringField,
} from "../account-route-helpers";
import { getAccountService } from "../../../../runtime/account-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonObject(request);
    const service = await getAccountService();
    await service.consumeRecoveryToken({
      token: stringField(body, "token"),
      newPassword: stringField(body, "newPassword"),
    });
    return jsonResponse({ ok: true });
  } catch (error) {
    return accountRouteErrorResponse(error);
  }
}

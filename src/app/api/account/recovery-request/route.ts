import {
  accountRouteErrorResponse,
  jsonResponse,
  optionalPositiveIntegerField,
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
    const recovery = await service.issueRecoveryToken({
      email: stringField(body, "email"),
      tokenDurationSeconds: optionalPositiveIntegerField(
        body,
        "tokenDurationSeconds",
      ),
    });
    return jsonResponse({
      recoveryToken: recovery.token,
      expiresAt: recovery.expiresAt,
    });
  } catch (error) {
    return accountRouteErrorResponse(error);
  }
}

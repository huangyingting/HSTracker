import { cookies } from "next/headers";

import { jsonErrorResponse } from "../../../http/json-error-response";
import {
  isAccountServiceError,
  type AccountService,
} from "../../../operations/account/account-service";
import type { Account } from "../../../operations/store/model";
import { isOperationalStoreError } from "../../../operations/store/errors";
import { getAccountService } from "../../../runtime/account-runtime";

export const SESSION_COOKIE_NAME = "hs_tracker_session";

type SessionContext = Readonly<{
  service: AccountService;
  account: Account;
  sessionToken: string;
}>;

export function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  const payload: unknown = await request.json();
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new TypeError("Expected a JSON object request body.");
  }
  return payload as Record<string, unknown>;
}

export function stringField(
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field];
  return typeof value === "string" ? value : "";
}

export function optionalPositiveIntegerField(
  body: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = body[field];
  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : undefined;
}

export async function requireSession(
  request: Request,
): Promise<SessionContext | Response> {
  const sessionToken = await sessionTokenFromRequest(request);
  if (sessionToken === null) {
    return unauthenticatedResponse();
  }
  const service = await getAccountService();
  const account = await service.resolveSession(sessionToken);
  if (account === null) {
    return unauthenticatedResponse(clearSessionCookieHeader());
  }
  return { service, account, sessionToken };
}

export async function accountPayload(
  service: AccountService,
  account: Account,
): Promise<{
  account: Account;
  primaryExporter: string;
  portfolio: Awaited<ReturnType<AccountService["listConfirmedProducts"]>>;
}> {
  return {
    account,
    primaryExporter: account.primaryExportEconomy,
    portfolio: await service.listConfirmedProducts(account.id),
  };
}

export function sessionCookieHeader(
  sessionToken: string,
  expiresAt: string,
  now = new Date(),
): string {
  const maxAge = Math.max(
    0,
    Math.floor((Date.parse(expiresAt) - now.getTime()) / 1000),
  );
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    secureCookie() ? "Secure" : null,
  ]
    .filter((part): part is string => part !== null)
    .join("; ");
}

export function clearSessionCookieHeader(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secureCookie() ? "Secure" : null,
  ]
    .filter((part): part is string => part !== null)
    .join("; ");
}

export function accountRouteErrorResponse(error: unknown): Response {
  if (isAccountServiceError(error)) {
    if (error.code === "INVALID_CREDENTIALS" || error.code === "CREDENTIAL_LOCKED") {
      return jsonErrorResponse(
        401,
        "INVALID_CREDENTIALS",
        "The credentials could not be verified.",
      );
    }
    if (error.code === "INVALID_RECOVERY_TOKEN") {
      return jsonErrorResponse(
        401,
        error.code,
        "The recovery token is expired, consumed, or unknown.",
      );
    }
    return jsonErrorResponse(400, error.code, error.message);
  }
  if (isOperationalStoreError(error)) {
    if (error.code === "UNKNOWN_ENTITY") {
      return jsonErrorResponse(404, "NOT_FOUND", "The account resource was not found.");
    }
    if (
      error.code === "APPLICATION_LEASE_UNAVAILABLE" ||
      error.code === "STORE_IN_MAINTENANCE"
    ) {
      return jsonErrorResponse(
        503,
        error.code,
        "The operational account store is temporarily unavailable.",
      );
    }
    return jsonErrorResponse(400, error.code, error.message);
  }
  if (error instanceof SyntaxError || error instanceof TypeError) {
    return jsonErrorResponse(400, "INVALID_ACCOUNT_REQUEST", "The account request is invalid.");
  }
  console.error("Account route request failed", error);
  return jsonErrorResponse(
    500,
    "INTERNAL_ERROR",
    "The account request could not be completed.",
  );
}

export function emptyResponse(status: number, headers: HeadersInit = {}): Response {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

async function sessionTokenFromRequest(
  request: Request,
): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (token !== undefined && token.length > 0) {
      return token;
    }
  } catch {
    // Direct route tests do not provide Next's request async-storage; fall
    // back to the concrete Request header while production still uses cookies().
  }
  return parseCookieHeader(request.headers.get("cookie"))[SESSION_COOKIE_NAME] ?? null;
}

function parseCookieHeader(header: string | null): Record<string, string> {
  if (header === null) {
    return {};
  }
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator === -1) {
          return [part, ""] as const;
        }
        return [
          part.slice(0, separator),
          decodeURIComponent(part.slice(separator + 1)),
        ] as const;
      }),
  );
}

function unauthenticatedResponse(setCookie?: string): Response {
  return jsonErrorResponse(
    401,
    "UNAUTHENTICATED",
    "Sign in to use the portfolio workspace.",
    undefined,
    setCookie === undefined ? {} : { "Set-Cookie": setCookie },
  );
}

function secureCookie(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.HS_TRACKER_RUNTIME_MODE !== "fixture"
  );
}

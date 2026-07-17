"use client";

import type { Account, ConfirmedProduct } from "../operations/store/model";

export type AccountSessionPayload = Readonly<{
  account: Account;
  primaryExporter: string;
  portfolio: readonly ConfirmedProduct[];
}>;

export class AccountClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AccountClientError";
  }
}

export async function loadAccountSession(): Promise<AccountSessionPayload | null> {
  const response = await fetch("/api/account/session/me", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (response.status === 401) {
    return null;
  }
  return readAccountResponse(response);
}

export async function registerAccount(input: {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly primaryExportEconomy: string;
}): Promise<AccountSessionPayload> {
  return postAccount("/api/account/register", input);
}

export async function signInAccount(input: {
  readonly email: string;
  readonly password: string;
}): Promise<AccountSessionPayload> {
  return postAccount("/api/account/sign-in", input);
}

export async function signOutAccount(): Promise<void> {
  const response = await fetch("/api/account/sign-out", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok && response.status !== 204) {
    await throwAccountError(response);
  }
}

export async function requestRecoveryToken(input: {
  readonly email: string;
}): Promise<{ recoveryToken: string; expiresAt: string }> {
  return postAccount("/api/account/recovery-request", input);
}

export async function consumeRecoveryToken(input: {
  readonly token: string;
  readonly newPassword: string;
}): Promise<void> {
  await postAccount("/api/account/recovery-consume", input);
}

export async function confirmPortfolioProduct(input: {
  readonly hsRevision: "HS12";
  readonly code: string;
}): Promise<readonly ConfirmedProduct[]> {
  const payload = await postAccount<{ portfolio: readonly ConfirmedProduct[] }>(
    "/api/account/portfolio/confirm",
    input,
  );
  return payload.portfolio;
}

export async function removePortfolioProduct(input: {
  readonly hsRevision: "HS12";
  readonly code: string;
}): Promise<readonly ConfirmedProduct[]> {
  const payload = await postAccount<{ portfolio: readonly ConfirmedProduct[] }>(
    "/api/account/portfolio/remove",
    input,
  );
  return payload.portfolio;
}

async function postAccount<T = AccountSessionPayload>(
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return readAccountResponse<T>(response);
}

async function readAccountResponse<T = AccountSessionPayload>(
  response: Response,
): Promise<T> {
  if (!response.ok) {
    await throwAccountError(response);
  }
  return (await response.json()) as T;
}

async function throwAccountError(response: Response): Promise<never> {
  let code = "ACCOUNT_REQUEST_FAILED";
  let message = `Account request returned ${response.status}.`;
  try {
    const payload: unknown = await response.json();
    if (
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "object" &&
      payload.error !== null
    ) {
      const error = payload.error as Record<string, unknown>;
      code = typeof error.code === "string" ? error.code : code;
      message = typeof error.message === "string" ? error.message : message;
    }
  } catch {
    // Keep the status-derived fallback.
  }
  throw new AccountClientError(response.status, code, message);
}

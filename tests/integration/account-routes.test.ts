import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixtureProductCatalog } from "../../src/catalog/fixture-product-catalog";
import { createFixtureEconomyDirectory } from "../../src/economy/fixture-economy-directory";
import { createAccountService } from "../../src/operations/account/account-service";
import type { OperationalStore } from "../../src/operations/store/operational-store";
import { SqliteOperationalStore } from "../../src/operations/store/sqlite-operational-store";
import {
  installAccountService,
  resetAccountServiceForTests,
} from "../../src/runtime/account-runtime";
import { ACCEPTANCE_FIXTURE_BUILD_IDS, ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS } from "../../fixtures/acceptance/v1/metadata";
import { POST as register } from "../../src/app/api/account/register/route";
import { GET as me } from "../../src/app/api/account/session/me/route";
import { POST as signIn } from "../../src/app/api/account/sign-in/route";
import { POST as signOut } from "../../src/app/api/account/sign-out/route";
import { POST as confirmProduct } from "../../src/app/api/account/portfolio/confirm/route";
import {
  makeTempStoreDir,
  removeTempStoreDir,
} from "../support/operational-store-env";

const tempDir = makeTempStoreDir();

let store: OperationalStore;
let restoreRuntime: (() => void) | null = null;

beforeEach(() => {
  store = new SqliteOperationalStore({
    filePath: join(tempDir, `${randomUUID()}.db`),
  });
  restoreRuntime = installAccountService(
    createAccountService({
      store,
      economyDirectory: createFixtureEconomyDirectory(),
      productCatalog: createFixtureProductCatalog(),
      economyAnalysisBuildId: ACCEPTANCE_FIXTURE_BUILD_IDS.core,
      productSearchBuildId: ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS.core,
    }),
    {
      economyAnalysisBuildId: ACCEPTANCE_FIXTURE_BUILD_IDS.core,
      productSearchBuildId: ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS.core,
    },
  );
});

afterEach(async () => {
  restoreRuntime?.();
  restoreRuntime = null;
  await resetAccountServiceForTests();
  await store.close();
});

afterAll(() => {
  removeTempStoreDir(tempDir);
});

describe("account route session and portfolio seam", () => {
  it("registers, restores the session from an opaque cookie, confirms portfolio products, and signs out without returning the token in JSON", async () => {
    const email = `route-${randomUUID()}@example.com`;
    const registered = await register(
      jsonRequest("/api/account/register", {
        email,
        password: "correct horse battery staple",
        displayName: "Route analyst",
        primaryExportEconomy: "156",
      }),
    );

    expect(registered.status).toBe(201);
    const setCookie = registered.headers.get("set-cookie");
    expect(setCookie).toMatch(/^hs_tracker_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+/u);
    const bodyText = await registered.text();
    expect(bodyText).not.toContain("sessionToken");
    expect(JSON.parse(bodyText)).toMatchObject({
      account: {
        displayName: "Route analyst",
        primaryExportEconomy: "156",
      },
      portfolio: [],
    });

    const cookie = cookieHeader(setCookie);
    const restored = await me(new Request("http://localhost/api/account/session/me", {
      headers: { Cookie: cookie },
    }));
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({
      account: { displayName: "Route analyst", primaryExportEconomy: "156" },
      primaryExporter: "156",
      portfolio: [],
    });

    const portfolio = await confirmProduct(
      jsonRequest(
        "/api/account/portfolio/confirm",
        { hsRevision: "HS12", code: "010121" },
        cookie,
      ),
    );
    expect(portfolio.status).toBe(200);
    await expect(portfolio.json()).resolves.toMatchObject({
      portfolio: [{ product: { hsRevision: "HS12", code: "010121" } }],
    });

    const signedOut = await signOut(
      new Request("http://localhost/api/account/sign-out", {
        method: "POST",
        headers: { Cookie: cookie },
      }),
    );
    expect(signedOut.status).toBe(204);
    expect(signedOut.headers.get("set-cookie")).toContain(
      "hs_tracker_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );

    const anonymous = await me(new Request("http://localhost/api/account/session/me", {
      headers: { Cookie: cookie },
    }));
    expect(anonymous.status).toBe(401);
  });

  it("uses a uniform credential failure response for missing account and wrong password", async () => {
    const missing = await signIn(
      jsonRequest("/api/account/sign-in", {
        email: "missing@example.com",
        password: "correct horse battery staple",
      }),
    );

    await register(
      jsonRequest("/api/account/register", {
        email: "existing@example.com",
        password: "correct horse battery staple",
        displayName: "Existing analyst",
        primaryExportEconomy: "156",
      }),
    );
    const wrongPassword = await signIn(
      jsonRequest("/api/account/sign-in", {
        email: "existing@example.com",
        password: "wrong password",
      }),
    );

    expect(missing.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(await missing.json()).toEqual(await wrongPassword.json());
  });
});

function jsonRequest(path: string, body: unknown, cookie?: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie === undefined ? {} : { Cookie: cookie }),
    },
    body: JSON.stringify(body),
  });
}

function cookieHeader(setCookie: string | null): string {
  if (setCookie === null) {
    throw new TypeError("Expected a session Set-Cookie header.");
  }
  return setCookie.split(";", 1)[0]!;
}

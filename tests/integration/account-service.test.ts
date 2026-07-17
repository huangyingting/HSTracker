import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { createFixtureProductCatalog } from "../../src/catalog/fixture-product-catalog";
import { createFixtureEconomyDirectory } from "../../src/economy/fixture-economy-directory";
import {
  createAccountService,
  isAccountServiceError,
  type AccountService,
} from "../../src/operations/account/account-service";
import { SqliteOperationalStore } from "../../src/operations/store/sqlite-operational-store";
import type { OperationalStore } from "../../src/operations/store/operational-store";
import {
  ACCEPTANCE_FIXTURE_BUILD_IDS,
  ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS,
} from "../../fixtures/acceptance/v1/metadata";
import {
  makeTempStoreDir,
  removeTempStoreDir,
} from "../support/operational-store-env";

const tempDir = makeTempStoreDir();

afterAll(() => {
  removeTempStoreDir(tempDir);
});

describe("AccountService", () => {
  let store: OperationalStore;
  let clock: MutableClock;
  let service: AccountService;

  afterEach(async () => {
    await store.close();
  });

  function createService(): AccountService {
    store = new SqliteOperationalStore({
      filePath: join(tempDir, `${randomUUID()}.db`),
      clock: () => clock.now(),
    });
    return createAccountService({
      store,
      economyDirectory: createFixtureEconomyDirectory(),
      productCatalog: createFixtureProductCatalog(),
      economyAnalysisBuildId: ACCEPTANCE_FIXTURE_BUILD_IDS.core,
      productSearchBuildId: ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS.core,
      clock: () => clock.now(),
    });
  }

  function resetService(): void {
    clock = new MutableClock("2026-07-17T05:54:48.000Z");
    service = createService();
  }

  it("registers with a validated primary exporter and authenticates with an opaque session", async () => {
    resetService();

    const registered = await service.registerAccount({
      email: " Analyst@Example.COM ",
      password: "correct horse battery staple",
      displayName: "Acme analyst",
      primaryExportEconomy: "76",
    });

    expect(registered.account).toMatchObject({
      displayName: "Acme analyst",
      primaryExportEconomy: "76",
    });

    await expect(
      service.registerAccount({
        email: "other@example.com",
        password: "correct horse battery staple",
        displayName: "Invalid exporter",
        primaryExportEconomy: "999",
      }),
    ).rejects.toSatisfy(hasAccountErrorCode("INVALID_PRIMARY_EXPORTER"));

    const signedIn = await service.authenticate({
      email: "analyst@example.com",
      password: "correct horse battery staple",
      sessionDurationSeconds: 3_600,
    });
    expect(signedIn.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(signedIn.expiresAt).toBe("2026-07-17T06:54:48.000Z");
    expect(await service.resolveSession(signedIn.sessionToken)).toEqual(
      registered.account,
    );

    await service.signOut(signedIn.sessionToken);
    expect(await service.resolveSession(signedIn.sessionToken)).toBeNull();
  });

  it("locks repeated failed authentication attempts and later accepts the correct password", async () => {
    resetService();
    await service.registerAccount({
      email: "lockable@example.com",
      password: "correct horse battery staple",
      displayName: "Lockable analyst",
      primaryExportEconomy: "76",
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        service.authenticate({
          email: "lockable@example.com",
          password: "wrong password",
        }),
      ).rejects.toSatisfy(hasAccountErrorCode("INVALID_CREDENTIALS"));
    }
    await expect(
      service.authenticate({
        email: "lockable@example.com",
        password: "wrong password",
      }),
    ).rejects.toSatisfy(hasAccountErrorCode("CREDENTIAL_LOCKED"));
    await expect(
      service.authenticate({
        email: "lockable@example.com",
        password: "correct horse battery staple",
      }),
    ).rejects.toSatisfy(hasAccountErrorCode("CREDENTIAL_LOCKED"));

    clock.advance(15 * 60 * 1000 + 1);

    const signedIn = await service.authenticate({
      email: "lockable@example.com",
      password: "correct horse battery staple",
    });
    expect(await service.resolveSession(signedIn.sessionToken)).toMatchObject({
      displayName: "Lockable analyst",
    });
  });

  it("recovers an account with a single-use token and revokes old sessions", async () => {
    resetService();
    await service.registerAccount({
      email: "recover@example.com",
      password: "old password",
      displayName: "Recoverable analyst",
      primaryExportEconomy: "76",
    });
    const oldSession = await service.authenticate({
      email: "recover@example.com",
      password: "old password",
    });

    const recovery = await service.issueRecoveryToken({
      email: "recover@example.com",
      tokenDurationSeconds: 600,
    });
    expect(recovery.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(recovery.expiresAt).toBe("2026-07-17T06:04:48.000Z");

    await service.consumeRecoveryToken({
      token: recovery.token,
      newPassword: "new password",
    });

    expect(await service.resolveSession(oldSession.sessionToken)).toBeNull();
    await expect(
      service.authenticate({
        email: "recover@example.com",
        password: "old password",
      }),
    ).rejects.toSatisfy(hasAccountErrorCode("INVALID_CREDENTIALS"));
    await expect(
      service.consumeRecoveryToken({
        token: recovery.token,
        newPassword: "another password",
      }),
    ).rejects.toSatisfy(hasAccountErrorCode("INVALID_RECOVERY_TOKEN"));
    await expect(
      service.authenticate({
        email: "recover@example.com",
        password: "new password",
      }),
    ).resolves.toMatchObject({
      account: { displayName: "Recoverable analyst" },
    });
  });

  it("rejects expired recovery tokens without changing the password", async () => {
    resetService();
    await service.registerAccount({
      email: "expired@example.com",
      password: "old password",
      displayName: "Expired token analyst",
      primaryExportEconomy: "76",
    });
    const recovery = await service.issueRecoveryToken({
      email: "expired@example.com",
      tokenDurationSeconds: 1,
    });

    clock.advance(1_001);

    await expect(
      service.consumeRecoveryToken({
        token: recovery.token,
        newPassword: "new password",
      }),
    ).rejects.toSatisfy(hasAccountErrorCode("INVALID_RECOVERY_TOKEN"));
    await expect(
      service.authenticate({
        email: "expired@example.com",
        password: "old password",
      }),
    ).resolves.toMatchObject({
      account: { displayName: "Expired token analyst" },
    });
  });

  it("changes the primary exporter only through an explicit validated account operation", async () => {
    resetService();
    const { account } = await service.registerAccount({
      email: "exporter@example.com",
      password: "correct horse battery staple",
      displayName: "Exporter analyst",
      primaryExportEconomy: "76",
    });

    await expect(
      service.setPrimaryExporter(account.id, "999"),
    ).rejects.toSatisfy(hasAccountErrorCode("INVALID_PRIMARY_EXPORTER"));
    expect((await service.getAccount(account.id))?.primaryExportEconomy).toBe(
      "76",
    );

    const changed = await service.setPrimaryExporter(account.id, "156");

    expect(changed).toMatchObject({
      id: account.id,
      primaryExportEconomy: "156",
      createdAt: account.createdAt,
    });
    expect((await service.getAccount(account.id))?.primaryExportEconomy).toBe(
      "156",
    );
  });

  it("keeps product search candidates out of the portfolio until an HS12 code is confirmed", async () => {
    resetService();
    const { account } = await service.registerAccount({
      email: "products@example.com",
      password: "correct horse battery staple",
      displayName: "Product analyst",
      primaryExportEconomy: "76",
    });

    const candidates = await service.searchProductCandidates({
      query: "Horses",
      locale: "en",
      limit: 5,
    });
    expect(candidates.matches.map((match) => match.product.code)).toEqual([
      "010121",
      "010129",
    ]);
    expect(await service.listConfirmedProducts(account.id)).toEqual([]);

    await expect(
      service.confirmProduct(account.id, {
        hsRevision: "HS12",
        code: "Horses: live, pure-bred breeding animals",
      }),
    ).rejects.toSatisfy(hasAccountErrorCode("INVALID_PRODUCT_IDENTITY"));
    await expect(
      service.confirmProduct(account.id, {
        hsRevision: "HS12",
        code: "999999",
      }),
    ).rejects.toSatisfy(hasAccountErrorCode("INVALID_PRODUCT_IDENTITY"));

    const confirmed = await service.confirmProduct(account.id, {
      hsRevision: "HS12",
      code: "010121",
    });
    expect(confirmed.map((entry) => entry.product)).toEqual([
      { hsRevision: "HS12", code: "010121" },
    ]);

    const removed = await service.removeProduct(account.id, {
      hsRevision: "HS12",
      code: "010121",
    });
    expect(removed).toEqual([]);
  });

  it("deletes an account without making analytical packages part of account state", async () => {
    resetService();
    const { account } = await service.registerAccount({
      email: "delete@example.com",
      password: "correct horse battery staple",
      displayName: "Delete analyst",
      primaryExportEconomy: "76",
    });
    const signedIn = await service.authenticate({
      email: "delete@example.com",
      password: "correct horse battery staple",
    });
    await service.confirmProduct(account.id, {
      hsRevision: "HS12",
      code: "010121",
    });

    await service.deleteAccount(account.id);

    expect(await service.getAccount(account.id)).toBeNull();
    expect(await service.resolveSession(signedIn.sessionToken)).toBeNull();
    expect(await service.listConfirmedProducts(account.id)).toEqual([]);
    await expect(
      service.authenticate({
        email: "delete@example.com",
        password: "correct horse battery staple",
      }),
    ).rejects.toSatisfy(hasAccountErrorCode("INVALID_CREDENTIALS"));
  });
});

class MutableClock {
  private current: Date;

  constructor(instant: string) {
    this.current = new Date(instant);
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

function hasAccountErrorCode(code: string) {
  return (error: unknown): boolean =>
    isAccountServiceError(error) && error.code === code;
}

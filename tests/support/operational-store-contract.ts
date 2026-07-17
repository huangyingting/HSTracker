import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isOperationalStoreError } from "../../src/operations/store/errors";
import type { OperationalStore } from "../../src/operations/store/operational-store";

const HS12 = "HS12";
const prod = (code: string) => ({ hsRevision: HS12, code });

/**
 * The single behavioral contract every operational-store adapter must satisfy.
 * Both PostgreSQL and SQLite run this identical suite; nothing here branches on
 * the underlying database.
 */
export function runOperationalStoreContract(
  label: string,
  makeStore: () => Promise<OperationalStore>,
): void {
  describe(`OperationalStore contract: ${label}`, () => {
    let store: OperationalStore;

    beforeEach(async () => {
      store = await makeStore();
    });

    afterEach(async () => {
      await store.close();
    });

    it("creates and reads an account with one primary export economy", async () => {
      const account = await store.createAccount({
        displayName: "Acme Exports",
        primaryExportEconomy: "076",
      });
      expect(account.id).toMatch(/[0-9a-f-]{36}/u);
      expect(account.primaryExportEconomy).toBe("076");
      const found = await store.findAccount(account.id);
      expect(found).toEqual(account);
      expect(await store.findAccount("00000000-0000-0000-0000-000000000000")).toBeNull();
    });

    it("stores credentials by normalized email identity and rejects duplicates", async () => {
      const account = await store.createAccount({
        displayName: "Acme Exports",
        primaryExportEconomy: "076",
      });
      const credential = await store.createCredential({
        accountId: account.id,
        identity: " Analyst@Example.COM ",
        verifier: "scrypt$16384$8$1$salt$hash",
      });

      expect(credential).toMatchObject({
        accountId: account.id,
        normalizedIdentity: "analyst@example.com",
        verifier: "scrypt$16384$8$1$salt$hash",
        failedAttemptCount: 0,
        lockedUntil: null,
      });
      expect(
        await store.findCredentialByIdentity("analyst@example.com"),
      ).toEqual(credential);
      expect(
        await store.findCredentialByIdentity("ANALYST@example.com"),
      ).toEqual(credential);
      expect(await store.findCredentialByAccount(account.id)).toEqual(
        credential,
      );

      const updated = await store.updateCredentialAttempts({
        credentialId: credential.id,
        failedAttemptCount: 3,
        lockedUntil: "2026-07-17T06:15:00.000Z",
      });
      expect(updated.failedAttemptCount).toBe(3);
      expect(updated.lockedUntil).toBe("2026-07-17T06:15:00.000Z");

      const rekeyed = await store.updateCredentialVerifier({
        credentialId: credential.id,
        verifier: "scrypt$16384$8$1$new$hash",
      });
      expect(rekeyed).toMatchObject({
        verifier: "scrypt$16384$8$1$new$hash",
        failedAttemptCount: 0,
        lockedUntil: null,
      });

      await expect(
        store.createCredential({
          accountId: account.id,
          identity: "analyst@example.com",
          verifier: "scrypt$16384$8$1$other$hash",
        }),
      ).rejects.toSatisfy(
        (error) =>
          isOperationalStoreError(error) &&
          error.code === "DUPLICATE_CREDENTIAL_IDENTITY",
      );
    });

    it("creates an account and credential atomically for registration", async () => {
      const registered = await store.createAccountWithCredential({
        displayName: "Registry Co",
        primaryExportEconomy: "076",
        credentialIdentity: "registry@example.com",
        credentialVerifier: "scrypt$16384$8$1$salt$hash",
      });

      expect(registered.account.displayName).toBe("Registry Co");
      expect(registered.credential.accountId).toBe(registered.account.id);
      expect(
        await store.findCredentialByIdentity("REGISTRY@example.com"),
      ).toEqual(registered.credential);

      await expect(
        store.createAccountWithCredential({
          displayName: "Duplicate Co",
          primaryExportEconomy: "156",
          credentialIdentity: "registry@example.com",
          credentialVerifier: "scrypt$16384$8$1$other$hash",
        }),
      ).rejects.toSatisfy(
        (error) =>
          isOperationalStoreError(error) &&
          error.code === "DUPLICATE_CREDENTIAL_IDENTITY",
      );
    });

    it("creates, expires, and revokes digest-only sessions", async () => {
      const account = await store.createAccount({
        displayName: "A",
        primaryExportEconomy: "076",
      });
      const live = await store.createSession({
        accountId: account.id,
        tokenDigest:
          "1111111111111111111111111111111111111111111111111111111111111111",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      expect(await store.findSession(live.tokenDigest)).toEqual(live);

      const expired = await store.createSession({
        accountId: account.id,
        tokenDigest:
          "2222222222222222222222222222222222222222222222222222222222222222",
        expiresAt: "2000-01-01T00:00:00.000Z",
      });
      expect(await store.findSession(expired.tokenDigest)).toBeNull();

      await store.revokeSession(live.tokenDigest);
      expect(await store.findSession(live.tokenDigest)).toBeNull();

      const second = await store.createSession({
        accountId: account.id,
        tokenDigest:
          "3333333333333333333333333333333333333333333333333333333333333333",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      await store.revokeSessionsForAccount(account.id);
      expect(await store.findSession(second.tokenDigest)).toBeNull();
    });

    it("consumes recovery token digests once and rejects expired tokens", async () => {
      const account = await store.createAccount({
        displayName: "A",
        primaryExportEconomy: "076",
      });
      const issued = await store.issueRecoveryToken({
        accountId: account.id,
        tokenDigest:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      expect(issued.consumedAt).toBeNull();

      const consumed = await store.consumeRecoveryToken(issued.tokenDigest);
      expect(consumed).toMatchObject({
        tokenDigest: issued.tokenDigest,
        accountId: account.id,
      });
      expect(consumed?.consumedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
      expect(await store.consumeRecoveryToken(issued.tokenDigest)).toBeNull();

      const expired = await store.issueRecoveryToken({
        accountId: account.id,
        tokenDigest:
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        expiresAt: "2000-01-01T00:00:00.000Z",
      });
      expect(await store.consumeRecoveryToken(expired.tokenDigest)).toBeNull();
    });

    it("appends account audit events and explicitly changes only the primary exporter", async () => {
      const account = await store.createAccount({
        displayName: "A",
        primaryExportEconomy: "076",
      });

      const created = await store.appendAuditEvent({
        accountId: account.id,
        kind: "ACCOUNT_CREATED",
        detail: { primaryExportEconomy: "076" },
      });
      await store.appendAuditEvent({
        accountId: null,
        kind: "SIGN_IN_REFUSED",
        detail: { reason: "INVALID_CREDENTIALS" },
      });
      const changed = await store.setPrimaryExporter(account.id, "156");

      expect(changed).toMatchObject({
        id: account.id,
        displayName: "A",
        primaryExportEconomy: "156",
        createdAt: account.createdAt,
      });
      expect(await store.findAccount(account.id)).toEqual(changed);
      expect(await store.listAuditEvents(account.id)).toEqual([created]);
    });

    it("replaces the whole portfolio atomically and dedupes references", async () => {
      const account = await store.createAccount({
        displayName: "A",
        primaryExportEconomy: "076",
      });
      const first = await store.confirmPortfolio(account.id, [
        prod("010101"),
        prod("020202"),
        prod("010101"),
      ]);
      expect(first.map((entry) => entry.product.code)).toEqual([
        "010101",
        "020202",
      ]);
      const replaced = await store.confirmPortfolio(account.id, [prod("030303")]);
      expect(replaced.map((entry) => entry.product.code)).toEqual(["030303"]);
      expect(await store.listConfirmedProducts(account.id)).toEqual(replaced);
    });

    it("rejects portfolio confirmation for an unknown account", async () => {
      await expect(
        store.confirmPortfolio("00000000-0000-0000-0000-000000000000", [
          prod("010101"),
        ]),
      ).rejects.toSatisfy(
        (error) =>
          isOperationalStoreError(error) && error.code === "UNKNOWN_ENTITY",
      );
    });

    it("opens a watch idempotently for the same product and market", async () => {
      const account = await store.createAccount({
        displayName: "A",
        primaryExportEconomy: "076",
      });
      const watch = await store.openWatch(account.id, {
        product: prod("010101"),
        marketEconomy: "156",
      });
      const again = await store.openWatch(account.id, {
        product: prod("010101"),
        marketEconomy: "156",
      });
      expect(again.id).toBe(watch.id);
      expect(await store.listWatches(account.id)).toHaveLength(1);
    });

    it("claims active watches without double-claiming across packages and completion", async () => {
      const account = await store.createAccount({
        displayName: "A",
        primaryExportEconomy: "076",
      });
      const w1 = await store.openWatch(account.id, {
        product: prod("010101"),
        marketEconomy: "156",
      });
      await store.openWatch(account.id, {
        product: prod("020202"),
        marketEconomy: "156",
      });
      await store.openWatch(account.id, {
        product: prod("030303"),
        marketEconomy: "156",
      });

      const firstBatch = await store.claimWatchesForEvaluation({
        evaluatorId: "e1",
        packageId: "P1",
        limit: 2,
        leaseSeconds: 300,
      });
      expect(firstBatch).toHaveLength(2);

      const secondBatch = await store.claimWatchesForEvaluation({
        evaluatorId: "e1",
        packageId: "P1",
        limit: 5,
        leaseSeconds: 300,
      });
      expect(secondBatch).toHaveLength(1);

      const w1Lease = [...firstBatch, ...secondBatch].find(
        (claim) => claim.watch.id === w1.id,
      )!;
      await store.completeEvaluation(w1Lease.leaseId, "P1");

      const noneLeft = await store.claimWatchesForEvaluation({
        evaluatorId: "e1",
        packageId: "P1",
        limit: 5,
        leaseSeconds: 300,
      });
      expect(noneLeft).toHaveLength(0);

      const nextPackage = await store.claimWatchesForEvaluation({
        evaluatorId: "e1",
        packageId: "P2",
        limit: 5,
        leaseSeconds: 300,
      });
      expect(nextPackage).toHaveLength(3);
    });

    it("appends alert events idempotently on (watch, dedupeKey)", async () => {
      const account = await store.createAccount({
        displayName: "A",
        primaryExportEconomy: "076",
      });
      const watch = await store.openWatch(account.id, {
        product: prod("010101"),
        marketEconomy: "156",
      });
      const first = await store.recordAlertEvent({
        watchId: watch.id,
        kind: "MOMENTUM_SIGNAL",
        dedupeKey: "P1:up",
        detail: { direction: "up" },
        occurredAt: "2026-01-01T00:00:00.000Z",
      });
      expect(first.created).toBe(true);

      const duplicate = await store.recordAlertEvent({
        watchId: watch.id,
        kind: "MOMENTUM_SIGNAL",
        dedupeKey: "P1:up",
        detail: { direction: "DIFFERENT" },
        occurredAt: "2026-02-02T00:00:00.000Z",
      });
      expect(duplicate.created).toBe(false);
      expect(duplicate.event.id).toBe(first.event.id);
      expect(duplicate.event.detail).toEqual({ direction: "up" });

      const events = await store.listAlertEvents(account.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.detail).toEqual({ direction: "up" });
    });

    it("rejects an alert event for an unknown watch", async () => {
      await expect(
        store.recordAlertEvent({
          watchId: "00000000-0000-0000-0000-000000000000",
          kind: "MOMENTUM_SIGNAL",
          dedupeKey: "x",
          detail: {},
          occurredAt: "2026-01-01T00:00:00.000Z",
        }),
      ).rejects.toSatisfy(
        (error) =>
          isOperationalStoreError(error) && error.code === "UNKNOWN_ENTITY",
      );
    });

    it("tracks per-channel delivery state and counts attempts", async () => {
      const account = await store.createAccount({
        displayName: "A",
        primaryExportEconomy: "076",
      });
      const watch = await store.openWatch(account.id, {
        product: prod("010101"),
        marketEconomy: "156",
      });
      const { event } = await store.recordAlertEvent({
        watchId: watch.id,
        kind: "MOMENTUM_SIGNAL",
        dedupeKey: "P1:up",
        detail: {},
        occurredAt: "2026-01-01T00:00:00.000Z",
      });
      expect(await store.getDeliveryState(event.id, "email")).toBeNull();

      const first = await store.markDelivered(event.id, "email");
      expect(first).toMatchObject({ status: "SENT", attempts: 1 });
      const second = await store.markDelivered(event.id, "email");
      expect(second.attempts).toBe(2);
    });

    it("deletes an account's operational rows while retaining the deletion audit record", async () => {
      const account = await store.createAccount({
        displayName: "Deletable",
        primaryExportEconomy: "076",
      });
      await store.createCredential({
        accountId: account.id,
        identity: "delete@example.com",
        verifier: "scrypt$16384$8$1$salt$hash",
      });
      const session = await store.createSession({
        accountId: account.id,
        tokenDigest:
          "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      const recovery = await store.issueRecoveryToken({
        accountId: account.id,
        tokenDigest:
          "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      await store.confirmPortfolio(account.id, [prod("010101")]);
      const watch = await store.openWatch(account.id, {
        product: prod("010101"),
        marketEconomy: "156",
      });
      const { event } = await store.recordAlertEvent({
        watchId: watch.id,
        kind: "MOMENTUM_SIGNAL",
        dedupeKey: "P1:up",
        detail: { direction: "up" },
        occurredAt: "2026-01-01T00:00:00.000Z",
      });
      await store.markDelivered(event.id, "email");
      await store.appendAuditEvent({
        accountId: account.id,
        kind: "ACCOUNT_CREATED",
        detail: {},
      });

      const deletion = await store.deleteAccount(account.id);

      expect(deletion).toMatchObject({
        accountId: account.id,
        kind: "ACCOUNT_DELETED",
        detail: {
          accountId: account.id,
          retentionPolicy: "operational-account-deletion-v1",
        },
      });
      expect(await store.findAccount(account.id)).toBeNull();
      expect(await store.findCredentialByIdentity("delete@example.com")).toBeNull();
      expect(await store.findSession(session.tokenDigest)).toBeNull();
      expect(await store.consumeRecoveryToken(recovery.tokenDigest)).toBeNull();
      expect(await store.listConfirmedProducts(account.id)).toEqual([]);
      expect(await store.listWatches(account.id)).toEqual([]);
      expect(await store.listAlertEvents(account.id)).toEqual([]);
      expect(await store.getDeliveryState(event.id, "email")).toBeNull();
      const auditKinds = (await store.listAuditEvents(account.id)).map(
        (audit) => audit.kind,
      );
      expect(auditKinds).toHaveLength(2);
      expect(auditKinds).toEqual(
        expect.arrayContaining(["ACCOUNT_CREATED", "ACCOUNT_DELETED"]),
      );
    });
  });
}

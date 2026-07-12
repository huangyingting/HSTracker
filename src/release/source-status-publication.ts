import {
  evaluateSourceFreshness,
  type SourceFreshnessState,
  type SourceStatusSnapshot,
} from "../domain/release/source-freshness";
import {
  contentAddressedId,
  MAX_RELEASE_METADATA_BYTES,
  readReleaseMetadata,
  releaseJsonBytes,
  type ReleaseObjectReference,
} from "./release-manifest";
import {
  ReleasePointerConflictError,
  releaseObjectIdentity,
  singleChunk,
  type ReleaseObjectReadOptions,
  type ReleaseObjectReader,
  type ReleaseObjectStore,
} from "./release-object-store";
import {
  boolean,
  prefixedId,
  record,
  sha256String,
  string,
  utcTimestamp,
} from "./release-validation";

export const ACTIVE_SOURCE_STATUS_POINTER_KEY =
  "source-status-pointers/current.json";
const MAX_STATUS_TRANSITION_ATTEMPTS = 3;

export type SourceStatusPublicationInput = Omit<
  SourceStatusSnapshot,
  "schemaVersion" | "sourceStatusSnapshotId"
>;

export type SourceStatusTransition = (
  current: PublishedSourceStatusSnapshot | null,
) =>
  | SourceStatusPublicationInput
  | Promise<SourceStatusPublicationInput>;

export type PublishedSourceStatusSnapshot = SourceStatusPublicationInput & {
  schemaVersion: "source-status-snapshot-v1";
  sourceStatusSnapshotId: string;
  freshnessStatusId: string;
  checkOverdueAt: string;
  refreshDueAt: string | null;
  state: SourceFreshnessState;
  effectiveAt: string;
};

export type ActiveSourceStatusPointer = {
  schemaVersion: "active-source-status-pointer-v1";
  current: ReleaseObjectReference;
  retained: ReleaseObjectReference[];
  publishedAt: string;
};

export type RetainedSourceStatuses = {
  current: PublishedSourceStatusSnapshot;
  retained: PublishedSourceStatusSnapshot[];
};

type CurrentSourceStatus = {
  pointer: ActiveSourceStatusPointer;
  pointerVersion: string;
  status: PublishedSourceStatusSnapshot;
};

export class SourceStatusPublicationError extends Error {
  constructor(
    readonly code:
      | "STATUS_ACTIVATION_FAILED"
      | "STATUS_ACTIVATION_CONFLICT"
      | "STATUS_REGRESSION",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SourceStatusPublicationError";
  }
}

export class SourceStatusReader {
  private readonly statusCache = new Map<
    string,
    PublishedSourceStatusSnapshot
  >();

  constructor(protected readonly objectStore: ReleaseObjectReader) {}

  async current(
    options: ReleaseObjectReadOptions = {},
  ): Promise<PublishedSourceStatusSnapshot | null> {
    return (await this.loadCurrent(options))?.status ?? null;
  }

  async currentAndRetained(
    options: ReleaseObjectReadOptions = {},
  ): Promise<RetainedSourceStatuses | null> {
    const current = await this.loadCurrent(options);
    if (current === null) {
      return null;
    }
    const retained = await Promise.all(
      current.pointer.retained.map((reference) =>
        this.readStatus(reference, options),
      ),
    );
    for (const status of retained) {
      if (
        Date.parse(status.publishedAt) >
          Date.parse(current.status.publishedAt) ||
        Date.parse(status.checkedAt) >
          Date.parse(current.status.checkedAt)
      ) {
        throw new Error(
          "A retained Source Freshness Status snapshot is incompatible with the active snapshot.",
        );
      }
    }
    const retainedKeys = new Set(
      [current.pointer.current, ...current.pointer.retained].map(
        statusReferenceCacheKey,
      ),
    );
    for (const key of this.statusCache.keys()) {
      if (!retainedKeys.has(key)) {
        this.statusCache.delete(key);
      }
    }
    return { current: current.status, retained };
  }

  protected async loadCurrent(
    options: ReleaseObjectReadOptions = {},
  ): Promise<CurrentSourceStatus | null> {
    const storedPointer = await this.objectStore.getObject(
      ACTIVE_SOURCE_STATUS_POINTER_KEY,
      options,
    );
    if (storedPointer === null) {
      return null;
    }
    const pointer = parseActiveSourceStatusPointer(
      JSON.parse(
        (await readReleaseMetadata(storedPointer.body)).toString("utf8"),
      ),
    );
    const status = await this.readStatus(pointer.current, options);
    if (status.publishedAt !== pointer.publishedAt) {
      throw new Error(
        "The active Source Freshness Status pointer does not match its snapshot.",
      );
    }
    return {
      pointer,
      pointerVersion: storedPointer.version,
      status,
    };
  }

  private async readStatus(
    reference: ReleaseObjectReference,
    options: ReleaseObjectReadOptions,
  ): Promise<PublishedSourceStatusSnapshot> {
    const cacheKey = statusReferenceCacheKey(reference);
    const cached = this.statusCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const statusBytes = await readVerifiedStatusObject(
      this.objectStore,
      reference,
      options,
    );
    const status = parsePublishedSourceStatusSnapshot(
      JSON.parse(statusBytes.toString("utf8")),
    );
    this.statusCache.set(cacheKey, status);
    return status;
  }
}

export class SourceStatusPublisher extends SourceStatusReader {
  constructor(private readonly store: ReleaseObjectStore) {
    super(store);
  }

  async publish(
    input: SourceStatusPublicationInput,
  ): Promise<PublishedSourceStatusSnapshot> {
    const current = await this.loadCurrent();
    return this.publishAgainstCurrent(input, current);
  }

  async publishTransition(
    transition: SourceStatusTransition,
  ): Promise<PublishedSourceStatusSnapshot> {
    for (
      let attempt = 1;
      attempt <= MAX_STATUS_TRANSITION_ATTEMPTS;
      attempt += 1
    ) {
      const current = await this.loadCurrent();
      const input = await transition(current?.status ?? null);
      try {
        return await this.publishAgainstCurrent(input, current);
      } catch (error) {
        if (
          !(
            error instanceof SourceStatusPublicationError &&
            error.code === "STATUS_ACTIVATION_CONFLICT" &&
            attempt < MAX_STATUS_TRANSITION_ATTEMPTS
          )
        ) {
          throw error;
        }
      }
    }
    throw new Error(
      "Source Freshness Status transition exhausted its retry budget.",
    );
  }

  private async publishAgainstCurrent(
    input: SourceStatusPublicationInput,
    current: CurrentSourceStatus | null,
  ): Promise<PublishedSourceStatusSnapshot> {
    const status = createPublishedSourceStatusSnapshot(input);
    const bytes = releaseJsonBytes(status);
    const identity = releaseObjectIdentity(bytes);
    const reference = {
      key: `source-status/${status.sourceStatusSnapshotId}.json`,
      ...identity,
    };
    if (
      current !== null &&
      (Date.parse(status.publishedAt) <
        Date.parse(current.status.publishedAt) ||
        Date.parse(status.checkedAt) <
          Date.parse(current.status.checkedAt))
    ) {
      throw new SourceStatusPublicationError(
        "STATUS_REGRESSION",
        "Source Freshness Status publication time cannot move backward.",
      );
    }
    if (
      current?.status.sourceStatusSnapshotId ===
      status.sourceStatusSnapshotId
    ) {
      return current.status;
    }

    await this.store.putImmutable(
      reference.key,
      singleChunk(bytes),
      identity,
    );
    const readBack = await readVerifiedStatusObject(
      this.store,
      reference,
    );
    if (!readBack.equals(bytes)) {
      throw new Error(
        "Source Freshness Status snapshot read-back differs.",
      );
    }
    const pointer: ActiveSourceStatusPointer = {
      schemaVersion: "active-source-status-pointer-v1",
      current: reference,
      retained: retainedReferences(current),
      publishedAt: status.publishedAt,
    };
    const pointerBytes = releaseJsonBytes(pointer);
    if (pointerBytes.byteLength > MAX_RELEASE_METADATA_BYTES) {
      throw new SourceStatusPublicationError(
        "STATUS_ACTIVATION_FAILED",
        "Source Freshness Status pointer exceeds its metadata size limit.",
      );
    }
    try {
      await this.store.compareAndSwap(
        ACTIVE_SOURCE_STATUS_POINTER_KEY,
        current?.pointerVersion ?? null,
        pointerBytes,
      );
    } catch (error) {
      throw new SourceStatusPublicationError(
        error instanceof ReleasePointerConflictError
          ? "STATUS_ACTIVATION_CONFLICT"
          : "STATUS_ACTIVATION_FAILED",
        error instanceof ReleasePointerConflictError
          ? "Source Freshness Status pointer changed concurrently."
          : "Source Freshness Status pointer activation failed.",
        { cause: error },
      );
    }
    return status;
  }
}

export function createPublishedSourceStatusSnapshot(
  input: SourceStatusPublicationInput,
): PublishedSourceStatusSnapshot {
  const sourceFields = validatedSourceFields(input);
  const sourceStatusSnapshotId = contentAddressedId(
    "source-status-v1",
    sourceFields,
  );
  const effective = evaluateSourceFreshness(
    {
      schemaVersion: "source-status-v1",
      sourceStatusSnapshotId,
      ...sourceFields,
    },
    sourceFields.publishedAt,
  );
  return {
    schemaVersion: "source-status-snapshot-v1",
    sourceStatusSnapshotId,
    freshnessStatusId: effective.freshnessStatusId,
    checkedAt: effective.checkedAt,
    checkOverdueAt: effective.checkOverdueAt,
    servedBaciRelease: effective.servedBaciRelease,
    latestKnownBaciRelease: effective.latestKnownBaciRelease,
    newerReleaseDetectedAt: effective.newerReleaseDetectedAt,
    refreshDueAt: effective.refreshDueAt,
    state: effective.state,
    effectiveAt: effective.effectiveAt,
    refreshFailed: sourceFields.refreshFailed,
    rollbackActive: sourceFields.rollbackActive,
    publishedAt: sourceFields.publishedAt,
  };
}

export function parsePublishedSourceStatusSnapshot(
  value: unknown,
): PublishedSourceStatusSnapshot {
  const snapshot = record(value, "Source Freshness Status snapshot");
  if (snapshot.schemaVersion !== "source-status-snapshot-v1") {
    throw new Error(
      "Source Freshness Status snapshot schema is incompatible.",
    );
  }
  const parsed = {
    checkedAt: utcTimestamp(snapshot.checkedAt, "source check time"),
    servedBaciRelease: string(
      snapshot.servedBaciRelease,
      "served BACI Release",
    ),
    latestKnownBaciRelease: string(
      snapshot.latestKnownBaciRelease,
      "latest known BACI Release",
    ),
    newerReleaseDetectedAt: nullableUtcTimestamp(
      snapshot.newerReleaseDetectedAt,
      "newer BACI Release detection time",
    ),
    refreshFailed: boolean(snapshot.refreshFailed, "refresh failure"),
    rollbackActive: boolean(snapshot.rollbackActive, "rollback state"),
    publishedAt: utcTimestamp(snapshot.publishedAt, "status publication time"),
  };
  const expected = createPublishedSourceStatusSnapshot(parsed);
  const actual: PublishedSourceStatusSnapshot = {
    schemaVersion: "source-status-snapshot-v1",
    sourceStatusSnapshotId: prefixedId(
      snapshot.sourceStatusSnapshotId,
      "Source Freshness Status snapshot ID",
      "source-status-v1",
    ),
    freshnessStatusId: string(
      snapshot.freshnessStatusId,
      "Source Freshness Status ID",
    ),
    checkedAt: parsed.checkedAt,
    checkOverdueAt: utcTimestamp(
      snapshot.checkOverdueAt,
      "source check overdue time",
    ),
    servedBaciRelease: parsed.servedBaciRelease,
    latestKnownBaciRelease: parsed.latestKnownBaciRelease,
    newerReleaseDetectedAt: parsed.newerReleaseDetectedAt,
    refreshDueAt: nullableUtcTimestamp(
      snapshot.refreshDueAt,
      "refresh due time",
    ),
    state: sourceFreshnessState(snapshot.state),
    effectiveAt: utcTimestamp(
      snapshot.effectiveAt,
      "freshness effective time",
    ),
    refreshFailed: parsed.refreshFailed,
    rollbackActive: parsed.rollbackActive,
    publishedAt: parsed.publishedAt,
  };
  if (releaseJsonBytes(actual).equals(releaseJsonBytes(expected)) === false) {
    throw new Error(
      "Source Freshness Status snapshot identities are inconsistent.",
    );
  }
  return actual;
}

export function sourceStatusSnapshot(
  published: PublishedSourceStatusSnapshot,
): SourceStatusSnapshot {
  return {
    schemaVersion: "source-status-v1",
    sourceStatusSnapshotId: published.sourceStatusSnapshotId,
    checkedAt: published.checkedAt,
    servedBaciRelease: published.servedBaciRelease,
    latestKnownBaciRelease: published.latestKnownBaciRelease,
    newerReleaseDetectedAt: published.newerReleaseDetectedAt,
    refreshFailed: published.refreshFailed,
    rollbackActive: published.rollbackActive,
    publishedAt: published.publishedAt,
  };
}

function validatedSourceFields(
  input: SourceStatusPublicationInput,
): SourceStatusPublicationInput {
  const checkedAt = utcTimestamp(input.checkedAt, "source check time");
  const newerReleaseDetectedAt = nullableUtcTimestamp(
    input.newerReleaseDetectedAt,
    "newer BACI Release detection time",
  );
  const publishedAt = utcTimestamp(
    input.publishedAt,
    "status publication time",
  );
  if (Date.parse(checkedAt) > Date.parse(publishedAt)) {
    throw new Error("Source check time cannot follow status publication.");
  }
  if (
    newerReleaseDetectedAt !== null &&
    Date.parse(newerReleaseDetectedAt) > Date.parse(publishedAt)
  ) {
    throw new Error(
      "Newer BACI Release detection time cannot follow status publication.",
    );
  }
  return {
    checkedAt,
    servedBaciRelease: string(
      input.servedBaciRelease,
      "served BACI Release",
    ),
    latestKnownBaciRelease: string(
      input.latestKnownBaciRelease,
      "latest known BACI Release",
    ),
    newerReleaseDetectedAt,
    refreshFailed: boolean(input.refreshFailed, "refresh failure"),
    rollbackActive: boolean(input.rollbackActive, "rollback state"),
    publishedAt,
  };
}

function parseActiveSourceStatusPointer(
  value: unknown,
): ActiveSourceStatusPointer {
  const pointer = record(
    value,
    "active Source Freshness Status pointer",
  );
  if (pointer.schemaVersion !== "active-source-status-pointer-v1") {
    throw new Error(
      "Active Source Freshness Status pointer schema is incompatible.",
    );
  }
  return {
    schemaVersion: "active-source-status-pointer-v1",
    current: objectReference(pointer.current),
    retained: referenceArray(pointer.retained),
    publishedAt: utcTimestamp(
      pointer.publishedAt,
      "Source Freshness Status pointer publication time",
    ),
  };
}

function retainedReferences(
  current: CurrentSourceStatus | null,
): ReleaseObjectReference[] {
  if (current === null) {
    return [];
  }
  const references = [
    ...current.pointer.retained,
    current.pointer.current,
  ];
  return [
    ...new Map(
      references.map((reference) => [reference.key, reference]),
    ).values(),
  ];
}

function statusReferenceCacheKey(
  reference: ReleaseObjectReference,
): string {
  return `${reference.key}:${reference.bytes}:${reference.sha256}`;
}

function referenceArray(value: unknown): ReleaseObjectReference[] {
  if (!Array.isArray(value)) {
    throw new Error(
      "Active source-status retained references must be an array.",
    );
  }
  return value.map(objectReference);
}

function objectReference(value: unknown): ReleaseObjectReference {
  const reference = record(value, "source-status object reference");
  return {
    key: string(reference.key, "source-status object key"),
    bytes: nonnegativeInteger(reference.bytes, "source-status object bytes"),
    sha256: sha256String(
      reference.sha256,
      "source-status object SHA-256",
    ),
  };
}

async function readVerifiedStatusObject(
  objectStore: ReleaseObjectReader,
  reference: ReleaseObjectReference,
  options: ReleaseObjectReadOptions = {},
): Promise<Buffer> {
  const stored = await objectStore.getObject(reference.key, options);
  if (stored === null) {
    throw new Error(
      "The active Source Freshness Status snapshot is unavailable.",
    );
  }
  const bytes = await readReleaseMetadata(stored.body);
  const identity = releaseObjectIdentity(bytes);
  if (
    identity.bytes !== reference.bytes ||
    identity.sha256 !== reference.sha256
  ) {
    throw new Error(
      "Source Freshness Status snapshot identity does not match.",
    );
  }
  return bytes;
}

function nullableUtcTimestamp(
  value: unknown,
  label: string,
): string | null {
  return value === null ? null : utcTimestamp(value, label);
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(`${label} must be a nonnegative safe integer.`);
  }
  return value;
}

function sourceFreshnessState(value: unknown): SourceFreshnessState {
  if (
    value !== "LATEST_KNOWN" &&
    value !== "UPDATE_IN_PROGRESS" &&
    value !== "REFRESH_DELAYED" &&
    value !== "CHECK_OVERDUE"
  ) {
    throw new Error("Source freshness state is invalid.");
  }
  return value;
}

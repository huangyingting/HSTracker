import {
  evaluateSourceFreshness,
  type SourceStatusSnapshot,
} from "../domain/release/source-freshness";
import type { ReleaseObjectReader } from "../release/release-object-store";
import {
  SourceStatusReader,
  sourceStatusSnapshot,
} from "../release/source-status-publication";

export type SourceStatusPollResult = "updated" | "unchanged" | "failed";

export type SourceFreshnessAlert = {
  level: "none" | "warn" | "page";
  reason:
    | "refresh-failed"
    | "rollback-active"
    | "refresh-over-24-hours"
    | "refresh-over-48-hours"
    | "source-check-overdue"
    | "status-pointer-poll-failures"
    | null;
};

export type SourceStatusPollerDiagnostics = {
  currentSourceStatusSnapshotId: string;
  consecutiveFailures: number;
  totalFailures: number;
  lastAttemptAt: string | null;
  lastSuccessfulPollAt: string | null;
  warningActive: boolean;
  alert: SourceFreshnessAlert;
};

export type SourceStatusPollerEvent =
  | {
      type: "status-poll-succeeded";
      polledAt: string;
      sourceStatusSnapshotId: string;
      changed: boolean;
    }
  | {
      type: "status-poll-failed";
      polledAt: string;
      consecutiveFailures: number;
      warningActive: boolean;
      error: unknown;
    }
  | {
      type: "freshness-alert-changed";
      observedAt: string;
      previous: SourceFreshnessAlert;
      current: SourceFreshnessAlert;
    };

type Timer = {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
};

type SourceStatusPollerInput = {
  objectStore: ReleaseObjectReader;
  servedBaciRelease: string;
  fallback: SourceStatusSnapshot;
  retain?: (snapshots: SourceStatusSnapshot[]) => void;
  accept: (snapshot: SourceStatusSnapshot) => void;
  now?: () => string;
  monotonicNow?: () => number;
  random?: () => number;
  observe?: (event: SourceStatusPollerEvent) => void;
  timer?: Timer;
};

const DEFAULT_TIMER: Timer = {
  schedule(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  cancel(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export class SourceStatusPoller {
  private readonly reader: SourceStatusReader;
  private readonly now: () => string;
  private readonly random: () => number;
  private readonly monotonicNow: () => number;
  private readonly timer: Timer;
  private current: SourceStatusSnapshot;
  private state: SourceStatusPollerDiagnostics;
  private inFlight: Promise<SourceStatusPollResult> | null = null;
  private timerHandle: unknown | null = null;
  private running = false;

  constructor(private readonly input: SourceStatusPollerInput) {
    if (input.fallback.servedBaciRelease !== input.servedBaciRelease) {
      throw new Error(
        "The source-status fallback does not match the served BACI Release.",
      );
    }
    this.reader = new SourceStatusReader(input.objectStore);
    this.now = input.now ?? currentUtcSecond;
    this.monotonicNow = input.monotonicNow ?? Date.now;
    this.random = input.random ?? Math.random;
    this.timer = input.timer ?? DEFAULT_TIMER;
    this.current = input.fallback;
    this.state = {
      currentSourceStatusSnapshotId:
        input.fallback.sourceStatusSnapshotId,
      consecutiveFailures: 0,
      totalFailures: 0,
      lastAttemptAt: null,
      lastSuccessfulPollAt: null,
      warningActive: false,
      alert: { level: "none", reason: null },
    };
  }

  pollOnce(): Promise<SourceStatusPollResult> {
    this.inFlight ??= this.performPoll().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.runAndSchedule();
  }

  stop(): void {
    this.running = false;
    if (this.timerHandle !== null) {
      this.timer.cancel(this.timerHandle);
      this.timerHandle = null;
    }
  }

  nextDelayMs(): number {
    const random = this.random();
    if (!Number.isFinite(random) || random < 0 || random >= 1) {
      throw new Error("Source-status poll jitter must be in [0, 1).");
    }
    return 60_000 - Math.floor(random * 5_001);
  }

  diagnostics(): SourceStatusPollerDiagnostics {
    return { ...this.state, alert: { ...this.state.alert } };
  }

  private async runAndSchedule(): Promise<void> {
    const startedAt = this.monotonicNow();
    const intervalMs = this.nextDelayMs();
    await this.pollOnce();
    if (!this.running) {
      return;
    }
    const elapsedMs = Math.max(
      0,
      this.monotonicNow() - startedAt,
    );
    this.timerHandle = this.timer.schedule(() => {
      this.timerHandle = null;
      void this.runAndSchedule();
    }, Math.max(0, intervalMs - elapsedMs));
  }

  private async performPoll(): Promise<SourceStatusPollResult> {
    const polledAt = this.now();
    this.state = { ...this.state, lastAttemptAt: polledAt };
    try {
      const statuses = await this.reader.currentAndRetained();
      if (statuses === null) {
        throw new Error("No active source-status snapshot is available.");
      }
      const published = statuses.current;
      if (
        published.servedBaciRelease !== this.input.servedBaciRelease
      ) {
        throw new Error(
          "The active source-status snapshot does not match the served BACI Release.",
        );
      }
      if (Date.parse(published.publishedAt) > Date.parse(polledAt)) {
        throw new Error(
          "The active source-status snapshot is dated in the future.",
        );
      }
      if (
        Date.parse(published.publishedAt) <
          Date.parse(this.current.publishedAt) ||
        Date.parse(published.checkedAt) <
          Date.parse(this.current.checkedAt)
      ) {
        throw new Error(
          "The active source-status snapshot regressed in publication time.",
        );
      }
      const changed =
        published.sourceStatusSnapshotId !==
        this.current.sourceStatusSnapshotId;
      this.input.retain?.(
        [published, ...statuses.retained].map(sourceStatusSnapshot),
      );
      if (changed) {
        const snapshot = sourceStatusSnapshot(published);
        this.input.accept(snapshot);
        this.current = snapshot;
      }
      this.state = {
        ...this.state,
        currentSourceStatusSnapshotId:
          published.sourceStatusSnapshotId,
        consecutiveFailures: 0,
        lastSuccessfulPollAt: polledAt,
        warningActive: false,
      };
      this.input.observe?.({
        type: "status-poll-succeeded",
        polledAt,
        sourceStatusSnapshotId:
          published.sourceStatusSnapshotId,
        changed,
      });
      this.updateAlert(polledAt, false);
      return changed ? "updated" : "unchanged";
    } catch (error) {
      const consecutiveFailures =
        this.state.consecutiveFailures + 1;
      this.state = {
        ...this.state,
        consecutiveFailures,
        totalFailures: this.state.totalFailures + 1,
        warningActive: consecutiveFailures >= 3,
      };
      this.input.observe?.({
        type: "status-poll-failed",
        polledAt,
        consecutiveFailures,
        warningActive: this.state.warningActive,
        error,
      });
      this.updateAlert(polledAt, this.state.warningActive);
      return "failed";
    }
  }

  private updateAlert(
    observedAt: string,
    pointerWarning: boolean,
  ): void {
    const freshnessAlert = sourceFreshnessAlert(
      this.current,
      observedAt,
    );
    const current =
      pointerWarning && freshnessAlert.level === "none"
        ? {
            level: "warn" as const,
            reason: "status-pointer-poll-failures" as const,
          }
        : freshnessAlert;
    const previous = this.state.alert;
    this.state = { ...this.state, alert: current };
    if (
      previous.level !== current.level ||
      previous.reason !== current.reason
    ) {
      this.input.observe?.({
        type: "freshness-alert-changed",
        observedAt,
        previous,
        current,
      });
    }
  }
}

function currentUtcSecond(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
}

export function sourceFreshnessAlert(
  snapshot: SourceStatusSnapshot,
  asOf: string,
): SourceFreshnessAlert {
  const effective = evaluateSourceFreshness(snapshot, asOf);
  if (snapshot.refreshFailed) {
    return { level: "page", reason: "refresh-failed" };
  }
  if (snapshot.rollbackActive) {
    return { level: "page", reason: "rollback-active" };
  }
  if (snapshot.newerReleaseDetectedAt !== null) {
    const refreshAgeMs =
      Date.parse(asOf) -
      Date.parse(snapshot.newerReleaseDetectedAt);
    if (refreshAgeMs >= 48 * 60 * 60 * 1000) {
      return {
        level: "page",
        reason: "refresh-over-48-hours",
      };
    }
    if (refreshAgeMs >= 24 * 60 * 60 * 1000) {
      return {
        level: "warn",
        reason: "refresh-over-24-hours",
      };
    }
    return { level: "none", reason: null };
  }
  if (effective.state === "CHECK_OVERDUE") {
    return { level: "page", reason: "source-check-overdue" };
  }
  return { level: "none", reason: null };
}

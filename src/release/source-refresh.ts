import type {
  PromoteReleaseInput,
  PublishedDeployment,
  ReleasePublisher,
} from "./release-publication";
import {
  createPublishedSourceStatusSnapshot,
  sourceStatusSnapshot,
  type PublishedSourceStatusSnapshot,
  type SourceStatusPublisher,
} from "./source-status-publication";

export type SourceRefreshBuild = (input: {
  baciRelease: string;
  signal?: AbortSignal;
}) => Promise<
  Pick<
    PromoteReleaseInput,
    "analysisDirectoryPath" | "productCatalogDirectoryPath"
  >
>;

export type SourceRefreshPromotionAuthorization = (
  candidate: Awaited<ReturnType<SourceRefreshBuild>>,
) => Promise<void>;

export type SourceRefreshEvent =
  | {
      type: "refresh-failed";
      baciRelease: string;
      failedAt: string;
      error: unknown;
    }
  | {
      type: "refresh-status-publication-failed";
      baciRelease: string;
      failedAt: string;
      error: unknown;
    }
  | {
      type: "rollback-activated";
      baciRelease: string;
      activatedAt: string;
    };

type SourceRefreshOrchestratorInput = {
  deployments: ReleasePublisher;
  statuses: SourceStatusPublisher;
  observe?: (event: SourceRefreshEvent) => void;
};

export class SourceRefreshError extends Error {
  constructor(
    readonly code:
      | "REFRESH_FAILED"
      | "REFRESH_STATE_INVALID"
      | "REFRESH_STATUS_FAILED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SourceRefreshError";
  }
}

export class SourceRefreshOrchestrator {
  constructor(private readonly input: SourceRefreshOrchestratorInput) {}

  async refresh(input: {
    baciRelease: string;
    activatedAt: string;
    build: SourceRefreshBuild;
    authorizePromotion: SourceRefreshPromotionAuthorization;
    signal?: AbortSignal;
  }): Promise<{
    deployment: PublishedDeployment;
    status: PublishedSourceStatusSnapshot;
  }> {
    const [initialDeployment, initialStatus] = await Promise.all([
      this.input.deployments.current(),
      this.input.statuses.current(),
    ]);
    if (initialDeployment === null) {
      throw invalidRefreshState(
        "Refresh requires an active deployment and detected Source Freshness Status.",
      );
    }
    if (initialDeployment.baciRelease === input.baciRelease) {
      return this.reconcileCompletedRefresh(
        initialDeployment,
        initialStatus,
      );
    }
    if (initialStatus === null) {
      throw invalidRefreshState(
        "Refresh requires an active deployment and detected Source Freshness Status.",
      );
    }
    if (
      initialStatus.servedBaciRelease !==
        initialDeployment.baciRelease ||
      initialStatus.latestKnownBaciRelease !== input.baciRelease ||
      initialStatus.newerReleaseDetectedAt === null ||
      initialStatus.servedBaciRelease === input.baciRelease
    ) {
      throw invalidRefreshState(
        "Refresh target does not match the active detected BACI Release.",
      );
    }

    let deployment: PublishedDeployment;
    try {
      const candidate = await input.build({
        baciRelease: input.baciRelease,
        signal: input.signal,
      });
      input.signal?.throwIfAborted();
      await input.authorizePromotion(candidate);
      input.signal?.throwIfAborted();
      const stateBeforePromotion = await this.refreshState(
        initialDeployment.deploymentPairingId,
      );
      const completedStatusInput = completedRefreshStatus(
        stateBeforePromotion.status,
        input.baciRelease,
        input.activatedAt,
      );
      deployment = await this.input.deployments.promote({
        ...candidate,
        activatedAt: input.activatedAt,
        expectedBaciRelease: input.baciRelease,
        expectedCurrentDeploymentPairingId:
          initialDeployment.deploymentPairingId,
        sourceStatusFallback: sourceStatusSnapshot(
          createPublishedSourceStatusSnapshot(
            completedStatusInput,
          ),
        ),
      });
      if (deployment.baciRelease !== input.baciRelease) {
        throw new Error(
          "Promoted deployment does not match the refresh target.",
        );
      }
    } catch (error) {
      this.input.observe?.({
        type: "refresh-failed",
        baciRelease: input.baciRelease,
        failedAt: input.activatedAt,
        error,
      });
      try {
        const failureState = await this.refreshState(
          initialDeployment.deploymentPairingId,
        );
        await this.input.statuses.publish(
          failedRefreshStatus(
            failureState.status,
            input.baciRelease,
            input.activatedAt,
          ),
        );
      } catch (statusError) {
        this.input.observe?.({
          type: "refresh-status-publication-failed",
          baciRelease: input.baciRelease,
          failedAt: input.activatedAt,
          error: statusError,
        });
        throw new SourceRefreshError(
          "REFRESH_STATUS_FAILED",
          "BACI Release refresh and delayed-status publication failed.",
          { cause: new AggregateError([error, statusError]) },
        );
      }
      throw new SourceRefreshError(
        "REFRESH_FAILED",
        "BACI Release refresh failed.",
        { cause: error },
      );
    }

    try {
      const currentStatus = await this.input.statuses.current();
      if (
        currentStatus === null ||
        (currentStatus.servedBaciRelease !==
          initialDeployment.baciRelease &&
          currentStatus.servedBaciRelease !== input.baciRelease)
      ) {
        throw new Error(
          "Source Freshness Status changed incompatibly during promotion.",
        );
      }
      const completedStatusInput = completedRefreshStatus(
        currentStatus,
        input.baciRelease,
        input.activatedAt,
      );
      const status = await this.input.statuses.publish(
        completedStatusInput,
      );
      return { deployment, status };
    } catch (error) {
      this.input.observe?.({
        type: "refresh-status-publication-failed",
        baciRelease: input.baciRelease,
        failedAt: input.activatedAt,
        error,
      });
      throw new SourceRefreshError(
        "REFRESH_STATUS_FAILED",
        "BACI Release was promoted but its Source Freshness Status was not published.",
        { cause: error },
      );
    }
  }

  private async reconcileCompletedRefresh(
    deployment: PublishedDeployment,
    currentStatus: PublishedSourceStatusSnapshot | null,
  ): Promise<{
    deployment: PublishedDeployment;
    status: PublishedSourceStatusSnapshot;
  }> {
    const fallback = deployment.sourceStatusFallback;
    if (
      fallback.servedBaciRelease !== deployment.baciRelease ||
      fallback.latestKnownBaciRelease !== deployment.baciRelease ||
      fallback.newerReleaseDetectedAt !== null ||
      fallback.refreshFailed ||
      fallback.rollbackActive
    ) {
      throw invalidRefreshState(
        "The active deployment does not contain a completed refresh fallback.",
      );
    }
    return this.reconcileDeploymentStatus(
      deployment,
      currentStatus,
      "BACI Release is active but its Source Freshness Status reconciliation failed.",
    );
  }

  private async reconcileDeploymentStatus(
    deployment: PublishedDeployment,
    currentStatus: PublishedSourceStatusSnapshot | null,
    failureMessage: string,
  ): Promise<{
    deployment: PublishedDeployment;
    status: PublishedSourceStatusSnapshot;
  }> {
    const fallback = deployment.sourceStatusFallback;
    const currentIsNewEnough =
      currentStatus !== null &&
      Date.parse(currentStatus.publishedAt) >=
        Date.parse(fallback.publishedAt) &&
      Date.parse(currentStatus.checkedAt) >= Date.parse(fallback.checkedAt);
    const currentDescribesDeployment =
      currentIsNewEnough &&
      currentStatus.servedBaciRelease === deployment.baciRelease;
    if (
      currentDescribesDeployment &&
      (!fallback.refreshFailed || currentStatus.refreshFailed) &&
      (!fallback.rollbackActive || currentStatus.rollbackActive)
    ) {
      return { deployment, status: currentStatus };
    }
    const statusInput = currentIsNewEnough
      ? {
          checkedAt: currentStatus.checkedAt,
          servedBaciRelease: deployment.baciRelease,
          latestKnownBaciRelease:
            currentStatus.latestKnownBaciRelease,
          newerReleaseDetectedAt:
            currentStatus.latestKnownBaciRelease ===
            deployment.baciRelease
              ? null
              : earliestUtcTimestamp(
                  currentStatus.newerReleaseDetectedAt,
                  fallback.newerReleaseDetectedAt,
                ) ?? fallback.publishedAt,
          refreshFailed:
            fallback.refreshFailed ||
            (currentDescribesDeployment &&
              currentStatus.refreshFailed),
          rollbackActive:
            fallback.rollbackActive ||
            (currentDescribesDeployment &&
              currentStatus.rollbackActive),
          publishedAt: currentStatus.publishedAt,
        }
      : {
          checkedAt: fallback.checkedAt,
          servedBaciRelease: fallback.servedBaciRelease,
          latestKnownBaciRelease: fallback.latestKnownBaciRelease,
          newerReleaseDetectedAt: fallback.newerReleaseDetectedAt,
          refreshFailed: fallback.refreshFailed,
          rollbackActive: fallback.rollbackActive,
          publishedAt: fallback.publishedAt,
        };
    try {
      const status = await this.input.statuses.publish(statusInput);
      return { deployment, status };
    } catch (error) {
      this.input.observe?.({
        type: "refresh-status-publication-failed",
        baciRelease: deployment.baciRelease,
        failedAt: fallback.publishedAt,
        error,
      });
      throw new SourceRefreshError(
        "REFRESH_STATUS_FAILED",
        failureMessage,
        { cause: error },
      );
    }
  }

  private async refreshState(
    expectedDeploymentPairingId: string,
  ): Promise<{
    deployment: PublishedDeployment;
    status: PublishedSourceStatusSnapshot;
  }> {
    const [deployment, status] = await Promise.all([
      this.input.deployments.current(),
      this.input.statuses.current(),
    ]);
    if (
      deployment === null ||
      status === null ||
      deployment.deploymentPairingId !==
        expectedDeploymentPairingId ||
      status.servedBaciRelease !== deployment.baciRelease
    ) {
      throw invalidRefreshState(
        "Active BACI Release state changed during refresh.",
      );
    }
    return { deployment, status };
  }

  async rollback(input: { activatedAt: string }): Promise<{
    deployment: PublishedDeployment;
    status: PublishedSourceStatusSnapshot;
  }> {
    const [currentDeployment, currentStatus] = await Promise.all([
      this.input.deployments.current(),
      this.input.statuses.current(),
    ]);
    if (
      currentDeployment !== null &&
      currentDeployment.sourceStatusFallback.rollbackActive &&
      currentDeployment.sourceStatusFallback.publishedAt ===
        input.activatedAt
    ) {
      const reconciled = await this.reconcileDeploymentStatus(
        currentDeployment,
        currentStatus,
        "BACI Release rollback is active but its Source Freshness Status reconciliation failed.",
      );
      this.input.observe?.({
        type: "rollback-activated",
        baciRelease: currentDeployment.baciRelease,
        activatedAt: input.activatedAt,
      });
      return reconciled;
    }
    if (
      currentDeployment === null ||
      currentStatus === null ||
      currentStatus.servedBaciRelease !==
        currentDeployment.baciRelease
    ) {
      throw invalidRefreshState(
        "Rollback requires an active Source Freshness Status.",
      );
    }
    const deployment = await this.input.deployments.rollback({
      ...input,
      expectedCurrentDeploymentPairingId:
        currentDeployment.deploymentPairingId,
      sourceStatus: sourceStatusSnapshot(currentStatus),
    });
    const result = await this.reconcileDeploymentStatus(
      deployment,
      currentStatus,
      "BACI Release rollback was activated but its Source Freshness Status was not published.",
    );
    this.input.observe?.({
      type: "rollback-activated",
      baciRelease: deployment.baciRelease,
      activatedAt: input.activatedAt,
    });
    return result;
  }
}

function invalidRefreshState(message: string): SourceRefreshError {
  return new SourceRefreshError("REFRESH_STATE_INVALID", message);
}

function completedRefreshStatus(
  current: PublishedSourceStatusSnapshot,
  servedBaciRelease: string,
  publishedAt: string,
) {
  const targetIsLatest =
    current.latestKnownBaciRelease === servedBaciRelease;
  return {
    checkedAt: current.checkedAt,
    servedBaciRelease,
    latestKnownBaciRelease: current.latestKnownBaciRelease,
    newerReleaseDetectedAt: targetIsLatest
      ? null
      : (current.newerReleaseDetectedAt ?? publishedAt),
    refreshFailed: false,
    rollbackActive: false,
    publishedAt,
  } as const;
}

function failedRefreshStatus(
  current: PublishedSourceStatusSnapshot,
  attemptedBaciRelease: string,
  publishedAt: string,
) {
  return {
    checkedAt: current.checkedAt,
    servedBaciRelease: current.servedBaciRelease,
    latestKnownBaciRelease: current.latestKnownBaciRelease,
    newerReleaseDetectedAt:
      current.newerReleaseDetectedAt ??
      (current.latestKnownBaciRelease === attemptedBaciRelease
        ? publishedAt
        : null),
    refreshFailed: true,
    rollbackActive: false,
    publishedAt,
  } as const;
}

function earliestUtcTimestamp(
  left: string | null,
  right: string | null,
): string | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

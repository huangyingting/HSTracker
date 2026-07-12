import type { SourceStatusSnapshot } from "../domain/release/source-freshness";
import { currentUtcSecond } from "../operations/utc-clock";
import type {
  PublishedSourceStatusSnapshot,
  SourceStatusPublisher,
} from "./source-status-publication";

export type BaciReleaseObservation = {
  baciRelease: string;
  sourceUrl: string;
};

export interface BaciReleaseSource {
  latestHs12Release(options?: {
    signal?: AbortSignal;
  }): Promise<BaciReleaseObservation>;
}

const CEPII_BACI_DOCUMENTATION_URL =
  "https://www.cepii.fr/DATA_DOWNLOAD/baci/doc/baci_webpage.html";
const CEPII_BACI_DATA_URL =
  "https://www.cepii.fr/DATA_DOWNLOAD/baci/data/";
const MAX_CEPII_DOCUMENTATION_BYTES = 2 * 1024 * 1024;

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class CepiiBaciReleaseSource implements BaciReleaseSource {
  private readonly fetch: Fetch;

  constructor(input: { fetch?: Fetch } = {}) {
    this.fetch = input.fetch ?? globalThis.fetch;
  }

  async latestHs12Release(options: {
    signal?: AbortSignal;
  } = {}): Promise<BaciReleaseObservation> {
    const response = await this.fetch(CEPII_BACI_DOCUMENTATION_URL, {
      method: "GET",
      headers: { accept: "text/html" },
      signal: options.signal,
    });
    if (!response.ok) {
      throw new Error(
        `CEPII BACI documentation returned HTTP ${response.status}.`,
      );
    }
    const html = await boundedResponseText(
      response,
      MAX_CEPII_DOCUMENTATION_BYTES,
    );
    const releases = [
      ...html.matchAll(/BACI_HS12_(V\d{6})\.zip/gu),
    ].map((match) => match[1]!);
    if (releases.length === 0) {
      throw new Error(
        "CEPII BACI documentation names no HS12 BACI Release archive.",
      );
    }
    releases.sort((left, right) => compareBaciReleases(right, left));
    const baciRelease = releases[0]!;
    return {
      baciRelease,
      sourceUrl: `${CEPII_BACI_DATA_URL}BACI_HS12_${baciRelease}.zip`,
    };
  }
}

export type SourceMonitorResult = {
  outcome: "unchanged" | "release-detected";
  status: PublishedSourceStatusSnapshot;
};

type SourceMonitorInput = {
  source: BaciReleaseSource;
  statuses: SourceStatusPublisher;
  deployments: SourceMonitorDeploymentReader;
  now?: () => string;
  observe?: (event: SourceMonitorEvent) => void;
};

export type SourceMonitorDeployment = {
  deploymentPairingId: string;
  baciRelease: string;
  sourceStatusFallback: SourceStatusSnapshot;
};

export interface SourceMonitorDeploymentReader {
  current(): Promise<SourceMonitorDeployment | null>;
}

export type SourceMonitorEvent = {
  type: "source-check-failed";
  checkedAt: string;
  error: unknown;
};

export class SourceMonitorError extends Error {
  readonly code = "SOURCE_CHECK_FAILED";

  constructor(options?: ErrorOptions) {
    super("CEPII source check failed.", options);
    this.name = "SourceMonitorError";
  }
}

export class SourceMonitor {
  private readonly now: () => string;

  constructor(private readonly input: SourceMonitorInput) {
    this.now = input.now ?? currentUtcSecond;
  }

  async check(input: {
    checkedAt?: string;
    signal?: AbortSignal;
  }): Promise<SourceMonitorResult> {
    let checkedAt = input.checkedAt;
    try {
      const observed = await this.input.source.latestHs12Release({
        signal: input.signal,
      });
      const successfulCheckedAt = checkedAt ?? this.now();
      checkedAt = successfulCheckedAt;
      let outcome: SourceMonitorResult["outcome"] = "unchanged";
      const status = await this.input.statuses.publishTransition(
        async (current) => {
          const deployment = await this.input.deployments.current();
          if (deployment === null) {
            throw new Error(
              "CEPII source monitoring requires an active deployment.",
            );
          }
          if (
            deployment.sourceStatusFallback.servedBaciRelease !==
            deployment.baciRelease
          ) {
            throw new Error(
              "Deployment Source Freshness Status fallback does not match the served BACI Release.",
            );
          }
          const comparison = compareBaciReleases(
            observed.baciRelease,
            deployment.baciRelease,
          );
          if (comparison < 0) {
            throw new Error(
              "CEPII reported a BACI Release older than the served BACI Release.",
            );
          }
          if (
            current !== null &&
            compareBaciReleases(
              observed.baciRelease,
              current.latestKnownBaciRelease,
            ) < 0
          ) {
            throw new Error(
              "CEPII reported a BACI Release older than the latest accepted check.",
            );
          }
          const releaseDetected = comparison > 0;
          const statusBaseline =
            current?.servedBaciRelease === deployment.baciRelease
              ? current
              : deployment.sourceStatusFallback;
          const priorDetectionAt =
            releaseDetected &&
            statusBaseline.newerReleaseDetectedAt !== null
              ? statusBaseline.newerReleaseDetectedAt
              : null;
          outcome = releaseDetected
            ? "release-detected"
            : "unchanged";
          return {
            checkedAt: successfulCheckedAt,
            servedBaciRelease: deployment.baciRelease,
            latestKnownBaciRelease: observed.baciRelease,
            newerReleaseDetectedAt: releaseDetected
              ? priorDetectionAt ?? successfulCheckedAt
              : null,
            refreshFailed: statusBaseline.refreshFailed,
            rollbackActive: statusBaseline.rollbackActive,
            publishedAt: successfulCheckedAt,
          };
        },
      );
      return { outcome, status };
    } catch (error) {
      checkedAt ??= this.now();
      this.input.observe?.({
        type: "source-check-failed",
        checkedAt,
        error,
      });
      throw new SourceMonitorError({ cause: error });
    }
  }
}

export function compareBaciReleases(
  left: string,
  right: string,
): number {
  return baciReleaseNumber(left) - baciReleaseNumber(right);
}

function baciReleaseNumber(value: string): number {
  const match = /^V(\d{6})$/u.exec(value);
  if (match === null) {
    throw new Error(`BACI Release ${value} is malformed.`);
  }
  return Number(match[1]);
}

async function boundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > maxBytes
  ) {
    throw new Error("CEPII BACI documentation exceeds its size limit.");
  }
  if (response.body === null) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    bytes += result.value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error(
        "CEPII BACI documentation exceeds its size limit.",
      );
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

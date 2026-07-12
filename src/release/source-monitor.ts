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
        "CEPII BACI documentation names no HS12 release archive.",
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
  observe?: (event: SourceMonitorEvent) => void;
};

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
  constructor(private readonly input: SourceMonitorInput) {}

  async check(input: {
    servedBaciRelease: string;
    checkedAt: string;
    signal?: AbortSignal;
  }): Promise<SourceMonitorResult> {
    const current = await this.input.statuses.current();
    let observed: BaciReleaseObservation;
    let comparison: number;
    try {
      observed = await this.input.source.latestHs12Release({
        signal: input.signal,
      });
      comparison = compareBaciReleases(
        observed.baciRelease,
        input.servedBaciRelease,
      );
      if (comparison < 0) {
        throw new Error(
          "CEPII reported a BACI Release older than the served release.",
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
    } catch (error) {
      this.input.observe?.({
        type: "source-check-failed",
        checkedAt: input.checkedAt,
        error,
      });
      throw new SourceMonitorError({ cause: error });
    }

    const releaseDetected = comparison > 0;
    const sameServedRelease =
      current?.servedBaciRelease === input.servedBaciRelease;
    const priorDetectionAt =
      releaseDetected &&
      sameServedRelease &&
      current?.newerReleaseDetectedAt !== null
        ? current?.newerReleaseDetectedAt
        : null;
    const status = await this.input.statuses.publish({
      checkedAt: input.checkedAt,
      servedBaciRelease: input.servedBaciRelease,
      latestKnownBaciRelease: observed.baciRelease,
      newerReleaseDetectedAt: releaseDetected
        ? priorDetectionAt ?? input.checkedAt
        : null,
      refreshFailed: sameServedRelease
        ? current.refreshFailed
        : false,
      rollbackActive: sameServedRelease
        ? current.rollbackActive
        : false,
      publishedAt: input.checkedAt,
    });
    return {
      outcome: releaseDetected ? "release-detected" : "unchanged",
      status,
    };
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

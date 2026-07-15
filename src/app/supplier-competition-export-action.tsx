"use client";

import { useEffect, useRef, useState } from "react";

import type { SupplierCompetitionV1Payload } from "../domain/trade-analytics/supplier-competition-v1-adapter";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import {
  SupplierCompetitionExportPreparationError,
  prepareSupplierCompetitionExport,
} from "./supplier-competition-export-client";

const copy = {
  en: {
    region: "Supplier Competition Result Export",
    eyebrow: "Supplier Competition Result Export",
    scope:
      "The complete bounded supplier-economy cohort plus the Provisional Year snapshot.",
    detail:
      "Stable English fields, Simplified Chinese product text, and complete provenance.",
    button: "Download complete CSV",
    preflighting: "Revalidating current source context…",
    downloading: "Preparing the immutable CSV download…",
    downloaded: "CSV download started.",
    stale:
      "The current analysis changed. Run the analysis again before exporting.",
    failed: "The complete CSV could not be downloaded.",
  },
  "zh-Hans": {
    region: "供应商竞争结果导出",
    eyebrow: "完整结果导出",
    scope: "完整的有界供应经济体群组，以及暂定年份快照。",
    detail: "包含稳定英文栏位、简体中文产品文本及完整来源信息。",
    button: "下载完整 CSV",
    preflighting: "正在重新验证当前来源情境…",
    downloading: "正在准备不可变 CSV 下载…",
    downloaded: "CSV 下载已开始。",
    stale: "当前分析已变更。请重新运行分析后再导出。",
    failed: "无法下载完整 CSV。",
  },
} as const;

type ExportLocale = keyof typeof copy;
type ExportStatus =
  | "idle"
  | "preflighting"
  | "downloading"
  | "downloaded"
  | "stale"
  | "failed";

class SupplierCompetitionCsvDownloadError extends Error {
  constructor(
    readonly stale: boolean,
    message: string,
  ) {
    super(message);
    this.name = "SupplierCompetitionCsvDownloadError";
  }
}

export function SupplierCompetitionExportAction({
  result,
  locale,
  onManifestRevalidated,
}: {
  result: SupplierCompetitionV1Payload;
  locale: ExportLocale;
  onManifestRevalidated: (manifest: CurrentAnalysisManifest) => void;
}) {
  const messages = copy[locale];
  const preflightController = useRef<AbortController | null>(null);
  const downloadController = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<ExportStatus>("idle");
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  useEffect(
    () => () => {
      preflightController.current?.abort();
      downloadController.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (pendingUrl === null) {
      return;
    }
    downloadController.current?.abort();
    const controller = new AbortController();
    downloadController.current = controller;

    void downloadCsv(pendingUrl, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) {
          setStatus("downloaded");
        }
      })
      .catch(async (error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (error instanceof SupplierCompetitionCsvDownloadError) {
          if (error.stale) {
            await revalidateAfterDownloadConflict(
              result,
              controller.signal,
              onManifestRevalidated,
            );
          }
          if (!controller.signal.aborted) {
            setStatus(error.stale ? "stale" : "failed");
          }
        } else {
          console.error("Supplier Competition CSV download failed", error);
          setStatus("failed");
        }
      })
      .finally(() => {
        if (downloadController.current === controller) {
          downloadController.current = null;
        }
        setPendingUrl(null);
      });

    return () => controller.abort();
  }, [onManifestRevalidated, pendingUrl, result]);

  async function beginExport() {
    preflightController.current?.abort();
    downloadController.current?.abort();
    const controller = new AbortController();
    preflightController.current = controller;
    setStatus("preflighting");
    try {
      const prepared = await prepareSupplierCompetitionExport({
        result,
        fetcher: fetch,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        return;
      }
      onManifestRevalidated(prepared.manifest);
      setStatus("downloading");
      setPendingUrl(prepared.url);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (error instanceof SupplierCompetitionExportPreparationError) {
        onManifestRevalidated(error.manifest);
        setStatus("stale");
      } else {
        console.error("Supplier Competition export preflight failed", error);
        setStatus("failed");
      }
    } finally {
      if (preflightController.current === controller) {
        preflightController.current = null;
      }
    }
  }

  const busy = status === "preflighting" || status === "downloading";
  return (
    <section className="candidate-export" aria-label={messages.region}>
      <div>
        <p>{messages.eyebrow}</p>
        <strong>{messages.scope}</strong>
        <span>{messages.detail}</span>
      </div>
      <button
        type="button"
        aria-label={messages.button}
        disabled={busy}
        onClick={() => void beginExport()}
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
        </svg>
        {messages.button}
      </button>
      {status !== "idle" ? (
        <p
          className={`candidate-export-status candidate-export-${status}`}
          role={status === "stale" || status === "failed" ? "alert" : "status"}
        >
          {messages[status]}
        </p>
      ) : null}
    </section>
  );
}

async function revalidateAfterDownloadConflict(
  result: SupplierCompetitionV1Payload,
  signal: AbortSignal,
  onManifestRevalidated: (manifest: CurrentAnalysisManifest) => void,
): Promise<void> {
  try {
    const prepared = await prepareSupplierCompetitionExport({
      result,
      fetcher: fetch,
      signal,
    });
    onManifestRevalidated(prepared.manifest);
  } catch (error) {
    if (signal.aborted) {
      return;
    }
    if (error instanceof SupplierCompetitionExportPreparationError) {
      onManifestRevalidated(error.manifest);
      return;
    }
    console.error(
      "Supplier Competition export conflict revalidation failed",
      error,
    );
  }
}

async function downloadCsv(url: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new SupplierCompetitionCsvDownloadError(
      response.status === 404 ||
        response.status === 409 ||
        response.status === 410,
      `Supplier Competition CSV returned ${response.status}.`,
    );
  }
  const contentType = response.headers.get("content-type");
  const disposition = response.headers.get("content-disposition");
  const filenameMatch =
    disposition?.match(
      /^attachment; filename="([A-Za-z0-9._-]+\.csv)"$/u,
    ) ?? null;
  if (
    contentType !== "text/csv; charset=utf-8; header=present" ||
    filenameMatch === null
  ) {
    throw new SupplierCompetitionCsvDownloadError(
      false,
      "Supplier Competition CSV returned invalid representation metadata.",
    );
  }

  const bytes = await response.arrayBuffer();
  const blobUrl = URL.createObjectURL(
    new Blob([bytes], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = filenameMatch[1]!;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);
}

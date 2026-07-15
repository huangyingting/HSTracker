"use client";

import { useEffect, useRef, useState } from "react";

import type { TradeExplorerV1Payload } from "../domain/trade-analytics/trade-explorer-v1-adapter";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import {
  TradeExplorerExportPreparationError,
  prepareTradeExplorerExport,
} from "./trade-explorer-export-client";

const copy = {
  en: {
    region: "Trade Explorer Result Export",
    eyebrow: "Trade Explorer Result Export",
    scope: "The complete bounded result: every row, the total row, and full provenance.",
    detail: "Deterministic, formula-safe CSV with analysis configuration, budget, and quality metadata.",
    button: "Download complete CSV",
    preflighting: "Revalidating current source context…",
    downloading: "Preparing the immutable CSV download…",
    downloaded: "CSV download started.",
    stale: "The current analysis changed. Run the analysis again before exporting.",
    failed: "The complete CSV could not be downloaded.",
  },
  "zh-Hans": {
    region: "贸易探索者结果导出",
    eyebrow: "完整结果导出",
    scope: "完整的有界结果：每一行、汇总行以及完整来源信息。",
    detail: "确定性、公式安全的 CSV，包含分析配置、预算与质量元数据。",
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

class TradeExplorerCsvDownloadError extends Error {
  constructor(
    readonly stale: boolean,
    message: string,
  ) {
    super(message);
    this.name = "TradeExplorerCsvDownloadError";
  }
}

export function TradeExplorerExportAction({
  result,
  locale,
  onManifestRevalidated,
}: {
  result: TradeExplorerV1Payload;
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
        if (error instanceof TradeExplorerCsvDownloadError) {
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
          console.error("Trade Explorer CSV download failed", error);
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
      const prepared = await prepareTradeExplorerExport({
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
      if (error instanceof TradeExplorerExportPreparationError) {
        onManifestRevalidated(error.manifest);
        setStatus("stale");
      } else {
        console.error("Trade Explorer export preflight failed", error);
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
  result: TradeExplorerV1Payload,
  signal: AbortSignal,
  onManifestRevalidated: (manifest: CurrentAnalysisManifest) => void,
): Promise<void> {
  try {
    const prepared = await prepareTradeExplorerExport({
      result,
      fetcher: fetch,
      signal,
    });
    onManifestRevalidated(prepared.manifest);
  } catch (error) {
    if (signal.aborted) {
      return;
    }
    if (error instanceof TradeExplorerExportPreparationError) {
      onManifestRevalidated(error.manifest);
      return;
    }
    console.error("Trade Explorer export conflict revalidation failed", error);
  }
}

async function downloadCsv(url: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new TradeExplorerCsvDownloadError(
      response.status === 404 ||
        response.status === 409 ||
        response.status === 410,
      `Trade Explorer CSV returned ${response.status}.`,
    );
  }
  const contentType = response.headers.get("content-type");
  const disposition = response.headers.get("content-disposition");
  const filenameMatch =
    disposition?.match(/^attachment; filename="([A-Za-z0-9._-]+\.csv)"$/u) ?? null;
  if (
    contentType !== "text/csv; charset=utf-8; header=present" ||
    filenameMatch === null
  ) {
    throw new TradeExplorerCsvDownloadError(
      false,
      "Trade Explorer CSV returned invalid representation metadata.",
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

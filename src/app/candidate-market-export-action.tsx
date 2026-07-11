"use client";

import { useEffect, useRef, useState } from "react";

import type { CandidateMarketResult } from "../domain/candidate-market/result";
import type { CurrentAnalysisManifest } from "../domain/release/current-analysis";
import {
  CandidateMarketExportPreparationError,
  prepareCandidateMarketExport,
} from "./candidate-market-export-client";

const copy = {
  en: {
    region: "Candidate Market result export",
    eyebrow: "Complete result export",
    scope: (count: number) =>
      count === 0
        ? "One attributable empty-analysis row"
        : `All ${count} Candidate Markets - independent of selection or comparison`,
    detail:
      "Stable English fields, Simplified Chinese product text, and complete provenance.",
    button: (count: number) =>
      count === 0
        ? "Download complete CSV for the empty analysis"
        : `Download complete CSV for all ${count} Candidate Markets`,
    buttonVisible: "Download complete CSV",
    preflighting: "Revalidating current source context…",
    downloading: "Preparing the immutable CSV download…",
    downloaded: "CSV download started.",
    stale:
      "The current analysis changed. Run the analysis again before exporting.",
    failed: "The complete CSV could not be downloaded.",
  },
  "zh-Hans": {
    region: "候选市场结果导出",
    eyebrow: "完整结果导出",
    scope: (count: number) =>
      count === 0
        ? "一条保留完整来源信息的空分析记录"
        : `全部 ${count} 个候选市场，不受当前选择或比较栏影响`,
    detail: "包含稳定英文栏位、简体中文产品文本及完整来源信息。",
    button: (count: number) =>
      count === 0 ? "下载空分析的完整 CSV" : `下载全部 ${count} 个候选市场的完整 CSV`,
    buttonVisible: "下载完整 CSV",
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

class CandidateMarketCsvDownloadError extends Error {
  constructor(
    readonly stale: boolean,
    message: string,
  ) {
    super(message);
    this.name = "CandidateMarketCsvDownloadError";
  }
}

export function CandidateMarketExportAction({
  result,
  locale,
  onManifestRevalidated,
}: {
  result: CandidateMarketResult;
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
        if (error instanceof CandidateMarketCsvDownloadError) {
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
          console.error("Candidate Market CSV download failed", error);
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
      const prepared = await prepareCandidateMarketExport({
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
      if (error instanceof CandidateMarketExportPreparationError) {
        onManifestRevalidated(error.manifest);
        setStatus("stale");
      } else {
        console.error("Candidate Market export preflight failed", error);
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
        <strong>{messages.scope(result.cohortSize)}</strong>
        <span>{messages.detail}</span>
      </div>
      <button
        type="button"
        aria-label={messages.button(result.cohortSize)}
        disabled={busy}
        onClick={() => void beginExport()}
      >
        {messages.buttonVisible}
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
  result: CandidateMarketResult,
  signal: AbortSignal,
  onManifestRevalidated: (manifest: CurrentAnalysisManifest) => void,
): Promise<void> {
  try {
    const prepared = await prepareCandidateMarketExport({
      result,
      fetcher: fetch,
      signal,
    });
    onManifestRevalidated(prepared.manifest);
  } catch (error) {
    if (signal.aborted) {
      return;
    }
    if (error instanceof CandidateMarketExportPreparationError) {
      onManifestRevalidated(error.manifest);
      return;
    }
    console.error(
      "Candidate Market export conflict revalidation failed",
      error,
    );
  }
}

async function downloadCsv(url: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new CandidateMarketCsvDownloadError(
      response.status === 404 ||
        response.status === 409 ||
        response.status === 410,
      `Candidate Market CSV returned ${response.status}.`,
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
    throw new CandidateMarketCsvDownloadError(
      false,
      "Candidate Market CSV returned invalid representation metadata.",
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

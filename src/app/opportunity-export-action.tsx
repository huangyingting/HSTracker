"use client";

import { useEffect, useRef, useState } from "react";

import type { OpportunityDiscoveryV1Payload } from "../domain/trade-analytics/opportunity-discovery-v1-adapter";
import {
  serializeOpportunityDiscoveryCsv,
  type OpportunityExportScope,
} from "../export/opportunity-discovery-csv";
import { loadCompleteOpportunityFeed } from "./opportunity-feed-pages";

const copy = {
  en: {
    region: "Opportunity result export",
    eyebrow: "Complete result export",
    scope: (count: number) =>
      `All ${count} rows in this Scope, independent of the visible viewport`,
    detail:
      "Stable English fields, canonical ordering, analytical identities, and complete provenance.",
    button: "Download complete CSV",
    preparing: "Loading the complete candidate cohort…",
    downloaded: "CSV download started.",
    failed: "The complete CSV could not be prepared.",
  },
  "zh-Hans": {
    region: "机会结果导出",
    eyebrow: "完整结果导出",
    scope: (count: number) => `此范围内全部 ${count} 行，不受当前可见视口影响`,
    detail: "包含稳定英文栏位、规范排序、分析身份及完整来源信息。",
    button: "下载完整 CSV",
    preparing: "正在加载完整候选队列…",
    downloaded: "CSV 下载已开始。",
    failed: "无法准备完整 CSV。",
  },
} as const;

type ExportStatus = "idle" | "preparing" | "downloaded" | "failed";

export function OpportunityExportAction({
  page,
  candidateKeys,
  scope,
  locale,
}: {
  page: OpportunityDiscoveryV1Payload;
  candidateKeys: readonly string[] | null;
  scope: OpportunityExportScope;
  locale: keyof typeof copy;
}) {
  const controllerRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<ExportStatus>("idle");
  const messages = copy[locale];
  const rowCount = candidateKeys?.length ?? page.cohortSize;

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function beginExport() {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("preparing");
    try {
      const completePage = await loadCompleteOpportunityFeed({
        page,
        fetcher: fetch,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        return;
      }
      const representation = serializeOpportunityDiscoveryCsv({
        page: completePage,
        candidateKeys,
        scope,
      });
      startDownload(representation.bytes, representation.filename);
      setStatus("downloaded");
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("Opportunity CSV export failed", error);
        setStatus("failed");
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }

  return (
    <section
      className="candidate-export opportunity-export"
      aria-label={messages.region}
    >
      <div>
        <p>{messages.eyebrow}</p>
        <strong>{messages.scope(rowCount)}</strong>
        <span>{messages.detail}</span>
      </div>
      <button
        type="button"
        disabled={status === "preparing"}
        onClick={() => void beginExport()}
      >
        {messages.button}
      </button>
      {status === "idle" ? null : (
        <p role={status === "failed" ? "alert" : "status"}>
          {messages[status]}
        </p>
      )}
    </section>
  );
}

function startDownload(bytes: Uint8Array<ArrayBuffer>, filename: string): void {
  const blobUrl = URL.createObjectURL(
    new Blob([bytes], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);
}

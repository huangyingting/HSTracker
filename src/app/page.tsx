"use client";

import Link from "next/link";
import { useState } from "react";

import { DiscoveryWorkspace } from "./discovery-workspace";

const copy = {
  en: {
    skipToContent: "Skip to the analysis workspace",
    brandTagline: "Public trade intelligence",
    publicWorkspace: "Public workspace",
    eyebrow: "Public merchandise-trade evidence",
    heading: "Find candidate markets worth a closer look.",
    lede:
      "HS Tracker helps export-oriented businesses interpret public international trade data and decide where deeper commercial investigation may be worthwhile.",
    noAccount: "No account required",
    accessDetail: "Open analysis built on public evidence",
    boundaryIndex: "Evidence boundary",
    boundaryTitle: "Discovery aid, not a recommendation.",
    boundaryBody:
      "Public trade indicators can guide further investigation. They do not predict profit, demand, or sales success.",
    uses: "Uses",
    usesValue: "Public international merchandise-trade data",
    supports: "Supports",
    supportsValue: "Prioritizing deeper commercial investigation",
    guideEyebrow: "How to read this workspace",
    guideTitle: "Evidence first. Decisions remain yours.",
    principles: [
      {
        title: "Public evidence",
        body: "Observed merchandise-trade records, not private company data.",
      },
      {
        title: "Transparent indicators",
        body: "Visible inputs and fixed methods, not an opaque prediction.",
      },
      {
        title: "Further investigation",
        body: "A focused starting point for research, not a final decision.",
      },
    ],
    footer: "Public data · Clear provenance · No company records",
  },
  "zh-Hans": {
    skipToContent: "跳转到分析工作区",
    brandTagline: "公共贸易洞察",
    publicWorkspace: "公共工作区",
    eyebrow: "公共商品贸易证据",
    heading: "寻找值得深入研究的候选市场。",
    lede:
      "HS Tracker 帮助出口型企业解读公开的国际贸易数据，判断哪些市场值得开展更深入的商业调查。",
    noAccount: "无需注册",
    accessDetail: "基于公共证据的开放分析",
    boundaryIndex: "证据边界",
    boundaryTitle: "发现线索，而非提供建议。",
    boundaryBody:
      "公共贸易指标可为进一步调查提供方向，但不能预测利润、需求或销售成功。",
    uses: "依据",
    usesValue: "公共国际商品贸易数据",
    supports: "用于",
    supportsValue: "确定商业调查的优先方向",
    guideEyebrow: "如何阅读本工作区",
    guideTitle: "证据优先，决策由您做出。",
    principles: [
      {
        title: "公共证据",
        body: "可观察的商品贸易记录，而非私营企业数据。",
      },
      {
        title: "透明指标",
        body: "输入和固定方法清晰可见，而非不透明的预测。",
      },
      {
        title: "深入调查",
        body: "聚焦研究的起点，而非最终决策。",
      },
    ],
    footer: "公共数据 · 来源清晰 · 不含企业记录",
  },
} as const;

type Locale = keyof typeof copy;

export default function Home() {
  const [locale, setLocale] = useState<Locale>("en");
  const messages = copy[locale];

  function selectLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    document.documentElement.lang = nextLocale;
  }

  return (
    <main className="site-shell">
      <a className="skip-link" href="#discovery">
        {messages.skipToContent}
      </a>
      <header className="topbar">
        <Link className="brand" href="/" aria-label="HS Tracker home">
          <span className="brand-mark" aria-hidden="true">
            HS
          </span>
          <span className="brand-name">
            <strong>HS Tracker</strong>
            <span>{messages.brandTagline}</span>
          </span>
        </Link>

        <div className="header-tools">
          <p className="public-status">
            <span aria-hidden="true" />
            {messages.publicWorkspace}
          </p>
          <div
            className="locale-switcher"
            role="group"
            aria-label="Language / 语言"
          >
            <button
              type="button"
              aria-pressed={locale === "en"}
              onClick={() => selectLocale("en")}
            >
              EN
            </button>
            <button
              type="button"
              aria-pressed={locale === "zh-Hans"}
              onClick={() => selectLocale("zh-Hans")}
            >
              简体中文
            </button>
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span aria-hidden="true" />
            {messages.eyebrow}
          </p>
          <h1>{messages.heading}</h1>
          <p className="lede">{messages.lede}</p>
          <p className="access-note">
            <span className="access-icon" aria-hidden="true">
              ↗
            </span>
            <span>
              <strong>{messages.noAccount}</strong>
              <small>{messages.accessDetail}</small>
            </span>
          </p>
        </div>

        <aside className="boundary-card" aria-labelledby="boundary-title">
          <div className="card-index">
            <span>01</span>
            {messages.boundaryIndex}
          </div>
          <div className="boundary-symbol" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h2 id="boundary-title">{messages.boundaryTitle}</h2>
          <p>{messages.boundaryBody}</p>
          <dl>
            <div>
              <dt>{messages.uses}</dt>
              <dd>{messages.usesValue}</dd>
            </div>
            <div>
              <dt>{messages.supports}</dt>
              <dd>{messages.supportsValue}</dd>
            </div>
          </dl>
        </aside>
      </section>

      <DiscoveryWorkspace locale={locale} />

      <section className="reading-guide" aria-labelledby="guide-title">
        <div className="guide-heading">
          <p>{messages.guideEyebrow}</p>
          <h2 id="guide-title">{messages.guideTitle}</h2>
        </div>
        <ol>
          {messages.principles.map((principle, index) => (
            <li key={principle.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{principle.title}</h3>
              <p>{principle.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="footer">
        <p>HS Tracker</p>
        <p>{messages.footer}</p>
      </footer>
    </main>
  );
}

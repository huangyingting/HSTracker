const markets = [
  {
    name: "Mexico",
    code: "MEX",
    score: 82,
    confidence: "High",
    importValue: "$8.4B",
    importNumeric: 8.4,
    growth: "12.3%",
    growthNumeric: 12.3,
    exporterShare: "21.4%",
    concentration: "Medium",
    latestYear: "2024",
    coverage: "5/5 years",
    components: {
      "Demand scale": 88,
      "Recent momentum": 79,
      "Exporter foothold": 84,
      "Market resilience": 75,
    },
    caveat: "Reported quantity units change in one year; value trend remains complete.",
  },
  {
    name: "Poland",
    code: "POL",
    score: 76,
    confidence: "High",
    importValue: "$5.9B",
    importNumeric: 5.9,
    growth: "8.7%",
    growthNumeric: 8.7,
    exporterShare: "17.8%",
    concentration: "Low",
    latestYear: "2024",
    coverage: "5/5 years",
    components: {
      "Demand scale": 76,
      "Recent momentum": 72,
      "Exporter foothold": 74,
      "Market resilience": 85,
    },
    caveat: "No material coverage warning in the illustrative series.",
  },
  {
    name: "Türkiye",
    code: "TUR",
    score: 71,
    confidence: "Medium",
    importValue: "$6.7B",
    importNumeric: 6.7,
    growth: "15.1%",
    growthNumeric: 15.1,
    exporterShare: "28.6%",
    concentration: "High",
    latestYear: "2023",
    coverage: "4/5 years",
    components: {
      "Demand scale": 80,
      "Recent momentum": 90,
      "Exporter foothold": 88,
      "Market resilience": 40,
    },
    caveat: "Latest year is older and one year is missing; treat momentum cautiously.",
  },
  {
    name: "Chile",
    code: "CHL",
    score: 66,
    confidence: "High",
    importValue: "$2.1B",
    importNumeric: 2.1,
    growth: "6.2%",
    growthNumeric: 6.2,
    exporterShare: "35.2%",
    concentration: "Medium",
    latestYear: "2024",
    coverage: "5/5 years",
    components: {
      "Demand scale": 54,
      "Recent momentum": 61,
      "Exporter foothold": 92,
      "Market resilience": 66,
    },
    caveat: "Smaller import base makes percentage movement more sensitive.",
  },
  {
    name: "South Africa",
    code: "ZAF",
    score: 59,
    confidence: "Low",
    importValue: "$1.6B",
    importNumeric: 1.6,
    growth: "4.9%",
    growthNumeric: 4.9,
    exporterShare: "31.8%",
    concentration: "Medium",
    latestYear: "2023",
    coverage: "3/5 years",
    components: {
      "Demand scale": 47,
      "Recent momentum": 56,
      "Exporter foothold": 86,
      "Market resilience": 48,
    },
    caveat: "Two missing years and an older latest observation lower confidence.",
  },
];

const exportEconomies = ["China", "Germany", "United States", "Vietnam"];
const products = [
  "8517.13 - Smartphones",
  "8507.60 - Lithium-ion accumulators",
  "9403.60 - Wooden furniture",
  "0901.11 - Coffee, not roasted",
];

const variants = {
  A: { name: "Focused workspace", render: renderWorkspace },
  B: { name: "Analyst matrix", render: renderConsole },
  C: { name: "Guided investigation", render: renderGuided },
};

const state = {
  exportEconomy: exportEconomies[0],
  product: products[0],
  selectedMarket: markets[0].code,
  comparedMarkets: new Set([markets[0].code, markets[1].code]),
  sort: "score",
  guidedStep: 1,
};

const app = document.querySelector("#app");
const switcher = document.querySelector("#prototype-switcher");
const variantLabel = document.querySelector("#variant-label");

function currentVariant() {
  const requested = new URLSearchParams(window.location.search).get("variant");
  return variants[requested] ? requested : "A";
}

function selectedMarket() {
  return markets.find((market) => market.code === state.selectedMarket) ?? markets[0];
}

function comparedMarkets() {
  return markets.filter((market) => state.comparedMarkets.has(market.code));
}

function sortedMarkets() {
  const copy = [...markets];
  if (state.sort === "growth") {
    return copy.sort((a, b) => b.growthNumeric - a.growthNumeric);
  }
  if (state.sort === "imports") {
    return copy.sort((a, b) => b.importNumeric - a.importNumeric);
  }
  return copy.sort((a, b) => b.score - a.score);
}

function optionList(options, selected) {
  return options
    .map(
      (option) =>
        `<option value="${escapeAttribute(option)}" ${option === selected ? "selected" : ""}>${option}</option>`,
    )
    .join("");
}

function confidenceBadge(confidence) {
  return `<span class="badge ${confidence.toLowerCase()}">● ${confidence} confidence</span>`;
}

function appHeader() {
  return `
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark">HS</span>
        <span><strong>HS Tracker</strong><small>Candidate Market discovery</small></span>
      </div>
      <div class="header-note">
        Public trade evidence for deciding where deeper commercial investigation is warranted.
        Not a prediction of sales, profit, or investment success.
      </div>
    </header>
  `;
}

function selectorFields() {
  return `
    <div class="field">
      <label for="export-economy">Export economy</label>
      <select id="export-economy" data-field="exportEconomy">
        ${optionList(exportEconomies, state.exportEconomy)}
      </select>
    </div>
    <div class="field">
      <label for="product">HS product</label>
      <select id="product" data-field="product">
        ${optionList(products, state.product)}
      </select>
    </div>
  `;
}

function disclaimer() {
  return `
    <div class="disclaimer">
      <span aria-hidden="true">ⓘ</span>
      <span><strong>Discovery aid, not a recommendation.</strong> Candidate Markets are signals for
      follow-up. Validate customers, competition, regulation, logistics, and margins separately.</span>
    </div>
  `;
}

function methodWarning() {
  return `
    <div class="method-warning">
      Scores and component names are placeholders used only to test information hierarchy.
      The scoring-method decision belongs to a separate investigation.
    </div>
  `;
}

function componentBars(market) {
  return Object.entries(market.components)
    .map(
      ([label, value]) => `
        <div class="component">
          <span>${label}</span>
          <span class="track"><span style="width: ${value}%"></span></span>
          <strong>${value}</strong>
        </div>
      `,
    )
    .join("");
}

function metricGrid(market) {
  return `
    <div class="metric-grid">
      <div class="metric"><span>Import value</span><strong>${market.importValue}</strong></div>
      <div class="metric"><span>5-year growth</span><strong>${market.growth}</strong></div>
      <div class="metric"><span>Export-economy share</span><strong>${market.exporterShare}</strong></div>
      <div class="metric"><span>Supplier concentration</span><strong>${market.concentration}</strong></div>
    </div>
  `;
}

function comparisonChips() {
  const compared = comparedMarkets();
  if (compared.length === 0) {
    return `<div class="empty">No Candidate Markets selected for comparison.</div>`;
  }
  return `
    <div class="compare-chip-row">
      ${compared
        .map(
          (market) => `
            <button class="compare-chip" type="button" data-action="toggle-compare" data-market="${market.code}">
              ${market.name} <span aria-label="Remove">×</span>
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderWorkspace() {
  const active = selectedMarket();
  const compared = comparedMarkets();
  return `
    ${appHeader()}
    <section class="page">
      <p class="eyebrow">Variant A · Master-detail workspace</p>
      <h1>Scan a ranking, then inspect the evidence.</h1>
      <p class="lede">
        Keeps the search context, ranked Candidate Markets, and one detailed evidence record visible
        together. Comparison is a secondary action collected in a tray.
      </p>
      ${disclaimer()}

      <div class="workspace-grid">
        <aside class="panel panel-pad workspace-filter">
          <h2>Define the search</h2>
          <p class="muted">Choose a reporting export economy and one HS product.</p>
          ${selectorFields()}
          <button class="button" type="button" data-action="refresh">Update ranking</button>
          <hr />
          <p class="field-label">Scope</p>
          <p class="muted">
            Illustrative annual trade data<br />
            2020-2024 · value in current USD
          </p>
          ${methodWarning()}
        </aside>

        <section>
          <div class="results-heading">
            <div>
              <h2>Ranked Candidate Markets</h2>
              <p class="muted">For ${state.exportEconomy} · ${state.product}</p>
            </div>
            <span class="badge">${markets.length} markets</span>
          </div>
          <div class="market-list">
            ${sortedMarkets()
              .map(
                (market, index) => `
                  <button
                    class="market-card ${market.code === active.code ? "selected" : ""}"
                    type="button"
                    data-action="select-market"
                    data-market="${market.code}"
                  >
                    <div class="market-card-top">
                      <div>
                        <span class="rank">#${index + 1}</span>
                        <h3>${market.name}</h3>
                        ${confidenceBadge(market.confidence)}
                      </div>
                      <span class="score">${market.score}<small>/100</small></span>
                    </div>
                    <div class="market-card-stats">
                      <span>Imports<strong>${market.importValue}</strong></span>
                      <span>Growth<strong>${market.growth}</strong></span>
                      <span>Your share<strong>${market.exporterShare}</strong></span>
                    </div>
                  </button>
                `,
              )
              .join("")}
          </div>
        </section>

        <article class="panel panel-pad workspace-evidence">
          <div class="evidence-header">
            <div>
              <p class="eyebrow">Evidence record</p>
              <h2>${active.name}</h2>
              <p class="muted">Latest observation ${active.latestYear} · ${active.coverage}</p>
            </div>
            <div class="evidence-score">
              <span class="score">${active.score}<small>/100</small></span>
              ${confidenceBadge(active.confidence)}
            </div>
          </div>
          <div class="evidence-sections">
            <section>
              <h3>What drives this rank</h3>
              ${componentBars(active)}
            </section>
            <section>
              <h3>Evidence at a glance</h3>
              ${metricGrid(active)}
            </section>
          </div>
          <p class="method-warning"><strong>Data note:</strong> ${active.caveat}</p>
          <div class="evidence-actions">
            <button class="button" type="button" data-action="toggle-compare" data-market="${active.code}">
              ${state.comparedMarkets.has(active.code) ? "Remove from comparison" : "Add to comparison"}
            </button>
            <button class="button secondary" type="button" data-action="export">Export evidence row</button>
          </div>
        </article>
      </div>

      <div class="compare-tray">
        <div>
          <strong>Comparison tray · ${compared.length}/3</strong>
          ${comparisonChips()}
        </div>
        <button class="button" type="button" data-action="scroll-evidence" ${compared.length < 2 ? "disabled" : ""}>
          Compare selected
        </button>
      </div>
    </section>
  `;
}

function renderConsole() {
  const active = selectedMarket();
  const compared = comparedMarkets();
  return `
    ${appHeader()}
    <section class="page console-page">
      <p class="eyebrow">Variant B · Dense analyst matrix</p>
      <div class="panel console-toolbar">
        ${selectorFields()}
        <div class="field">
          <label for="sort">Sort ranking by</label>
          <select id="sort" data-field="sort">
            <option value="score" ${state.sort === "score" ? "selected" : ""}>Candidate Market Score</option>
            <option value="growth" ${state.sort === "growth" ? "selected" : ""}>5-year growth</option>
            <option value="imports" ${state.sort === "imports" ? "selected" : ""}>Import value</option>
          </select>
        </div>
        <button class="button" type="button" data-action="export">Export table</button>
      </div>

      <div class="console-summary">
        <div>
          <h1>Candidate Market matrix</h1>
          <p class="muted">${state.exportEconomy} · ${state.product} · annual observations</p>
        </div>
        ${disclaimer()}
      </div>
      ${methodWarning()}

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Compare</th>
              <th>Candidate Market</th>
              <th>Score</th>
              <th>Confidence</th>
              <th>Imports</th>
              <th>5-year growth</th>
              <th>Your share</th>
              <th>Concentration</th>
              <th>Coverage</th>
            </tr>
          </thead>
          <tbody>
            ${sortedMarkets()
              .map(
                (market) => `
                  <tr class="${market.code === active.code ? "active" : ""}" data-action="select-market" data-market="${market.code}">
                    <td>
                      <input
                        type="checkbox"
                        aria-label="Compare ${market.name}"
                        data-action="toggle-compare"
                        data-market="${market.code}"
                        ${state.comparedMarkets.has(market.code) ? "checked" : ""}
                      />
                    </td>
                    <td><strong>${market.name}</strong><small>${market.caveat}</small></td>
                    <td><span class="mini-score">${market.score}</span></td>
                    <td>${confidenceBadge(market.confidence)}</td>
                    <td>${market.importValue}</td>
                    <td>${market.growth}</td>
                    <td>${market.exporterShare}</td>
                    <td>${market.concentration}</td>
                    <td>${market.coverage}<small>Latest ${market.latestYear}</small></td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>

      <div class="console-lower">
        <article class="panel panel-pad">
          <p class="eyebrow">Selected row</p>
          <h2>${active.name} evidence log</h2>
          <div class="signal-log">
            ${Object.entries(active.components)
              .map(
                ([label, value]) => `
                  <div class="signal">
                    <div><strong>${label}</strong><p>Placeholder normalized indicator</p></div>
                    <span class="mini-score">${value}</span>
                  </div>
                `,
              )
              .join("")}
          </div>
          <p class="method-warning"><strong>Data note:</strong> ${active.caveat}</p>
        </article>

        <article class="panel panel-pad">
          <div class="results-heading">
            <div>
              <p class="eyebrow">Side-by-side</p>
              <h2>Selected Candidate Markets</h2>
            </div>
            <span class="badge">${compared.length}/3 selected</span>
          </div>
          ${
            compared.length
              ? `
                <div class="table-wrap">
                  <table class="comparison-table">
                    <thead><tr><th>Evidence</th>${compared.map((market) => `<th>${market.name}</th>`).join("")}</tr></thead>
                    <tbody>
                      <tr><td>Score</td>${compared.map((market) => `<td>${market.score}</td>`).join("")}</tr>
                      <tr><td>Confidence</td>${compared.map((market) => `<td>${market.confidence}</td>`).join("")}</tr>
                      <tr><td>Imports</td>${compared.map((market) => `<td>${market.importValue}</td>`).join("")}</tr>
                      <tr><td>Growth</td>${compared.map((market) => `<td>${market.growth}</td>`).join("")}</tr>
                      <tr><td>Coverage</td>${compared.map((market) => `<td>${market.coverage}</td>`).join("")}</tr>
                    </tbody>
                  </table>
                </div>
              `
              : `<div class="empty">Select rows in the matrix to compare them here.</div>`
          }
        </article>
      </div>
    </section>
  `;
}

function renderGuided() {
  return `
    ${appHeader()}
    <section class="page guided-page">
      <div class="guided-hero">
        <div>
          <p class="eyebrow">Variant C · Guided investigation</p>
          <h1>Build a defensible shortlist in four steps.</h1>
          <p class="lede">
            Progressive disclosure for occasional analysts: define the question, review evidence,
            compare a shortlist, then export a follow-up brief.
          </p>
        </div>
        <nav class="guided-progress" aria-label="Investigation steps">
          ${["Define search", "Review evidence", "Compare shortlist", "Export follow-up"]
            .map(
              (label, index) => `
                <button
                  class="step-button ${state.guidedStep === index + 1 ? "active" : ""} ${state.guidedStep > index + 1 ? "complete" : ""}"
                  type="button"
                  data-action="guided-step"
                  data-step="${index + 1}"
                >
                  <span>${state.guidedStep > index + 1 ? "✓" : index + 1}</span><strong>${label}</strong>
                </button>
              `,
            )
            .join("")}
        </nav>
      </div>

      <article class="panel guided-body">
        ${renderGuidedStep()}
      </article>
    </section>
  `;
}

function renderGuidedStep() {
  if (state.guidedStep === 1) {
    return `
      <div class="guided-body-header">
        <div><p class="eyebrow">Step 1 of 4</p><h2>What market question are you investigating?</h2></div>
        <span class="badge">Search context stays visible</span>
      </div>
      <div class="setup-card">
        <section>
          ${selectorFields()}
        </section>
        <aside class="selection-preview">
          <h3>Investigation brief</h3>
          <dl>
            <dt>Export economy</dt><dd>${state.exportEconomy}</dd>
            <dt>Product</dt><dd>${state.product}</dd>
            <dt>Time scope</dt><dd>Illustrative 2020-2024 series</dd>
            <dt>Purpose</dt><dd>Find markets for deeper commercial investigation</dd>
          </dl>
          ${disclaimer()}
        </aside>
      </div>
      <div class="guided-footer">
        <span class="muted">Selections can be changed later.</span>
        <button class="button" type="button" data-action="guided-next">Review Candidate Markets →</button>
      </div>
    `;
  }

  if (state.guidedStep === 2) {
    return `
      <div class="guided-body-header">
        <div>
          <p class="eyebrow">Step 2 of 4</p>
          <h2>Review the evidence behind the ranking.</h2>
          <p class="muted">${state.exportEconomy} · ${state.product}</p>
        </div>
        <span class="badge">${state.comparedMarkets.size}/3 shortlisted</span>
      </div>
      ${methodWarning()}
      <div class="evidence-deck">
        ${sortedMarkets()
          .slice(0, 3)
          .map(
            (market, index) => `
              <article class="evidence-card ${state.comparedMarkets.has(market.code) ? "selected" : ""}">
                <div class="evidence-card-rank">
                  <span class="rank">Candidate #${index + 1}</span>
                  <span class="score">${market.score}<small>/100</small></span>
                </div>
                <h2>${market.name}</h2>
                ${confidenceBadge(market.confidence)}
                <p class="muted">${market.caveat}</p>
                ${metricGrid(market)}
                <button class="button ${state.comparedMarkets.has(market.code) ? "secondary" : ""}" type="button" data-action="toggle-compare" data-market="${market.code}">
                  ${state.comparedMarkets.has(market.code) ? "Remove from shortlist" : "Add to shortlist"}
                </button>
              </article>
            `,
          )
          .join("")}
      </div>
      <div class="guided-footer">
        <button class="button ghost" type="button" data-action="guided-previous">← Back</button>
        <button class="button" type="button" data-action="guided-next" ${state.comparedMarkets.size < 2 ? "disabled" : ""}>Compare shortlist →</button>
      </div>
    `;
  }

  if (state.guidedStep === 3) {
    const compared = comparedMarkets();
    return `
      <div class="guided-body-header">
        <div><p class="eyebrow">Step 3 of 4</p><h2>Compare evidence, not just rank.</h2></div>
        ${confidenceBadge(lowestConfidence(compared))}
      </div>
      <div class="guided-comparison">
        ${compared
          .map(
            (market) => `
              <section class="comparison-column">
                <span class="rank">${market.code}</span>
                <h2>${market.name}</h2>
                <span class="mini-score">${market.score}/100</span>
                ${confidenceBadge(market.confidence)}
                ${metricGrid(market)}
                <h3>Why it ranked here</h3>
                ${componentBars(market)}
                <p class="method-warning"><strong>Check:</strong> ${market.caveat}</p>
                <button class="button secondary small-button" type="button" data-action="toggle-compare" data-market="${market.code}">Remove</button>
              </section>
            `,
          )
          .join("")}
      </div>
      <div class="guided-footer">
        <button class="button ghost" type="button" data-action="guided-previous">← Revise shortlist</button>
        <button class="button" type="button" data-action="guided-next" ${compared.length < 2 ? "disabled" : ""}>Prepare export →</button>
      </div>
    `;
  }

  const compared = comparedMarkets();
  return `
    <div class="guided-body-header">
      <div><p class="eyebrow">Step 4 of 4</p><h2>Export a follow-up brief.</h2></div>
      <span class="badge">${compared.length} Candidate Markets</span>
    </div>
    <div class="export-preview">
      <section>
        <h3>Included fields</h3>
        <div class="export-fields">
          <span>Export economy</span><span>HS product</span><span>Candidate Market</span>
          <span>Illustrative score</span><span>Data confidence</span><span>Import value</span>
          <span>5-year growth</span><span>Export-economy share</span><span>Coverage warning</span>
        </div>
        <button class="button" type="button" data-action="export">Download CSV follow-up table</button>
      </section>
      <aside>
        ${disclaimer()}
        <h3>Next investigation</h3>
        <p class="muted">
          Use this file to record customer evidence, local regulation, tariffs, competition,
          route-to-market, landed cost, and margin assumptions outside HS Tracker.
        </p>
        ${comparisonChips()}
      </aside>
    </div>
    <div class="guided-footer">
      <button class="button ghost" type="button" data-action="guided-previous">← Back to comparison</button>
      <span class="muted">The export preserves provenance and uncertainty notes.</span>
    </div>
  `;
}

function lowestConfidence(items) {
  const levels = ["Low", "Medium", "High"];
  return items.reduce(
    (lowest, market) =>
      levels.indexOf(market.confidence) < levels.indexOf(lowest) ? market.confidence : lowest,
    "High",
  );
}

function toggleComparison(code) {
  if (state.comparedMarkets.has(code)) {
    state.comparedMarkets.delete(code);
  } else if (state.comparedMarkets.size < 3) {
    state.comparedMarkets.add(code);
  }
}

function exportCsv(singleCode) {
  const selected = singleCode
    ? markets.filter((market) => market.code === singleCode)
    : comparedMarkets().length
      ? comparedMarkets()
      : markets;
  const rows = [
    [
      "Export economy",
      "HS product",
      "Candidate Market",
      "Illustrative score",
      "Data confidence",
      "Import value",
      "5-year growth",
      "Export-economy share",
      "Latest year",
      "Coverage",
      "Data note",
      "Decision-use warning",
    ],
    ...selected.map((market) => [
      state.exportEconomy,
      state.product,
      market.name,
      market.score,
      market.confidence,
      market.importValue,
      market.growth,
      market.exporterShare,
      market.latestYear,
      market.coverage,
      market.caveat,
      "Candidate Market evidence only; validate commercial viability separately.",
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "candidate-market-follow-up.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function changeVariant(direction) {
  const keys = Object.keys(variants);
  const index = keys.indexOf(currentVariant());
  const nextIndex = (index + direction + keys.length) % keys.length;
  const url = new URL(window.location.href);
  url.searchParams.set("variant", keys[nextIndex]);
  window.history.replaceState({}, "", url);
  render();
}

function render() {
  const key = currentVariant();
  app.innerHTML = variants[key].render();
  variantLabel.textContent = `${key} — ${variants[key].name}`;
}

document.addEventListener("change", (event) => {
  const field = event.target.dataset.field;
  if (field) {
    state[field] = event.target.value;
    render();
  }
});

document.addEventListener("click", (event) => {
  const switchDirection = event.target.closest("[data-switch]")?.dataset.switch;
  if (switchDirection) {
    changeVariant(switchDirection === "next" ? 1 : -1);
    return;
  }

  const control = event.target.closest("[data-action]");
  if (!control) {
    return;
  }
  const { action, market, step } = control.dataset;
  if (action === "select-market") {
    state.selectedMarket = market;
  } else if (action === "toggle-compare") {
    toggleComparison(market);
  } else if (action === "guided-step") {
    state.guidedStep = Number(step);
  } else if (action === "guided-next") {
    state.guidedStep = Math.min(4, state.guidedStep + 1);
  } else if (action === "guided-previous") {
    state.guidedStep = Math.max(1, state.guidedStep - 1);
  } else if (action === "export") {
    exportCsv(currentVariant() === "A" ? state.selectedMarket : undefined);
  } else if (action === "scroll-evidence") {
    document.querySelector(".workspace-evidence")?.scrollIntoView({ behavior: "smooth" });
  }
  render();
});

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const isEditing =
    target.matches("input, textarea, select") || target.closest("[contenteditable='true']");
  if (isEditing) {
    return;
  }
  if (event.key === "ArrowLeft") {
    changeVariant(-1);
  } else if (event.key === "ArrowRight") {
    changeVariant(1);
  }
});

switcher.hidden = document.documentElement.dataset.prototype !== "true";
render();

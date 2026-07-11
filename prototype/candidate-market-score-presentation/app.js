const markets = [
  {
    code: "MEX",
    name: "Mexico",
    rank: 1,
    confidence: 100,
    confidenceLabel: "High",
    observedYears: "5/5",
    deductions: [],
    caveat: "No material score-window coverage warning.",
    provisional: {
      marketValue: "$9.10B",
      bilateralValue: "$2.05B",
      share: "22.5%",
      quantityCoverage: "97%",
    },
    components: [
      {
        label: "Market Size",
        weight: 30,
        percentile: 90,
        raw: "$8.42B/year",
        detail: "Mean recorded world imports, 2019-2023",
        state: "computed",
        interpretation: "Above most observed markets on import scale.",
      },
      {
        label: "Market Growth",
        weight: 25,
        percentile: 78,
        raw: "12.3%/year",
        detail: "Log-linear nominal growth, 5 observed years",
        state: "computed",
        interpretation: "Higher nominal growth than much of the cohort.",
      },
      {
        label: "Recorded Foothold",
        weight: 25,
        percentile: 84,
        raw: "21.4% share",
        detail: "Selected export economy's recorded share, 2019-2023",
        state: "computed",
        interpretation: "A relatively established recorded position.",
      },
      {
        label: "Supplier Diversity",
        weight: 20,
        percentile: 76,
        raw: "0.72 index",
        detail: "Mean diversity among alternative recorded suppliers",
        state: "computed",
        interpretation: "Alternatives are more diverse than in many markets.",
      },
    ],
  },
  {
    code: "TUR",
    name: "Türkiye",
    rank: 4,
    confidence: 65,
    confidenceLabel: "Medium",
    observedYears: "3/5",
    deductions: [
      { label: "Two missing score-window years", points: 20 },
      { label: "Finalized cutoff year is missing", points: 15 },
    ],
    caveat:
      "2023 finalized evidence is missing. The 2024 provisional snapshot does not fill that score-window gap.",
    provisional: {
      marketValue: "$7.05B",
      bilateralValue: "$1.97B",
      share: "27.9%",
      quantityCoverage: "94%",
    },
    components: [
      {
        label: "Market Size",
        weight: 30,
        percentile: 82,
        raw: "$6.70B/year",
        detail: "Mean recorded world imports, 3 of 5 years",
        state: "computed",
        interpretation: "A large observed import market in the cohort.",
      },
      {
        label: "Market Growth",
        weight: 25,
        percentile: 91,
        raw: "15.1%/year",
        detail: "Log-linear nominal growth, minimum 3 observed years",
        state: "computed",
        interpretation: "High relative growth, supported by limited coverage.",
      },
      {
        label: "Recorded Foothold",
        weight: 25,
        percentile: 90,
        raw: "28.6% share",
        detail: "Selected export economy's recorded share",
        state: "computed",
        interpretation: "A high recorded share relative to other markets.",
      },
      {
        label: "Supplier Diversity",
        weight: 20,
        percentile: 35,
        raw: "0.31 index",
        detail: "Mean diversity among alternative recorded suppliers",
        state: "computed",
        interpretation: "Alternative supply is relatively concentrated.",
      },
    ],
  },
  {
    code: "POL",
    name: "Poland",
    rank: 7,
    confidence: 90,
    confidenceLabel: "High",
    observedYears: "4/5",
    deductions: [{ label: "One missing score-window year", points: 10 }],
    caveat: "One non-cutoff year is missing; the latest finalized year is recorded.",
    provisional: {
      marketValue: "$6.25B",
      bilateralValue: "$1.15B",
      share: "18.4%",
      quantityCoverage: "99%",
    },
    components: [
      {
        label: "Market Size",
        weight: 30,
        percentile: 75,
        raw: "$5.90B/year",
        detail: "Mean recorded world imports, 4 of 5 years",
        state: "computed",
        interpretation: "A relatively large observed market.",
      },
      {
        label: "Market Growth",
        weight: 25,
        percentile: 64,
        raw: "8.70%/year",
        detail: "Log-linear nominal growth, 4 observed years",
        state: "computed",
        interpretation: "Above-median nominal growth in the cohort.",
      },
      {
        label: "Recorded Foothold",
        weight: 25,
        percentile: 72,
        raw: "17.8% share",
        detail: "Selected export economy's recorded share",
        state: "computed",
        interpretation: "An established recorded position.",
      },
      {
        label: "Supplier Diversity",
        weight: 20,
        percentile: 88,
        raw: "0.84 index",
        detail: "Mean diversity among alternative recorded suppliers",
        state: "computed",
        interpretation: "Alternative suppliers are broadly distributed.",
      },
    ],
  },
  {
    code: "CHL",
    name: "Chile",
    rank: 11,
    confidence: 100,
    confidenceLabel: "High",
    observedYears: "5/5",
    deductions: [],
    caveat: "No material score-window coverage warning.",
    provisional: {
      marketValue: "$2.30B",
      bilateralValue: "$0.82B",
      share: "35.7%",
      quantityCoverage: "91%",
    },
    components: [
      {
        label: "Market Size",
        weight: 30,
        percentile: 55,
        raw: "$2.10B/year",
        detail: "Mean recorded world imports, 2019-2023",
        state: "computed",
        interpretation: "Near the middle of the cohort on import scale.",
      },
      {
        label: "Market Growth",
        weight: 25,
        percentile: 60,
        raw: "6.20%/year",
        detail: "Log-linear nominal growth, 5 observed years",
        state: "computed",
        interpretation: "Modestly above the cohort midpoint.",
      },
      {
        label: "Recorded Foothold",
        weight: 25,
        percentile: 93,
        raw: "35.2% share",
        detail: "Selected export economy's recorded share",
        state: "computed",
        interpretation: "One of the stronger recorded positions in the cohort.",
      },
      {
        label: "Supplier Diversity",
        weight: 20,
        percentile: 66,
        raw: "0.61 index",
        detail: "Mean diversity among alternative recorded suppliers",
        state: "computed",
        interpretation: "Alternative supply is moderately diverse.",
      },
    ],
  },
  {
    code: "ZAF",
    name: "South Africa",
    rank: 24,
    confidence: 40,
    confidenceLabel: "Low",
    observedYears: "2/5",
    deductions: [
      { label: "Three missing score-window years", points: 30 },
      { label: "Finalized cutoff year is missing", points: 15 },
      { label: "Supplier structure is unknown", points: 10 },
      { label: "Sparse-evidence cap applied to 40", points: null },
    ],
    caveat:
      "Only two finalized years are observed. Neutral components preserve fixed weights but do not imply average evidence.",
    provisional: {
      marketValue: null,
      bilateralValue: null,
      share: null,
      quantityCoverage: null,
    },
    components: [
      {
        label: "Market Size",
        weight: 30,
        percentile: 42,
        raw: "$1.60B/year",
        detail: "Mean recorded world imports, 2 of 5 years",
        state: "computed",
        interpretation: "Below the cohort midpoint on observed import scale.",
      },
      {
        label: "Market Growth",
        weight: 25,
        percentile: 50,
        raw: "Not computed",
        detail: "Fewer than 3 observed years",
        state: "neutral",
        interpretation: "Neutral midpoint because direction is unsupported.",
      },
      {
        label: "Recorded Foothold",
        weight: 25,
        percentile: 28,
        raw: "No recorded flow",
        detail: "No recorded bilateral flow in observed score-window years",
        state: "computed",
        interpretation: "A low derived share of recorded BACI flows.",
      },
      {
        label: "Supplier Diversity",
        weight: 20,
        percentile: 50,
        raw: "Not computed",
        detail: "No year has an alternative recorded supplier",
        state: "neutral",
        interpretation: "Neutral midpoint because structure is unknown.",
      },
    ],
  },
];

const variants = {
  A: { name: "Weighted evidence stack", render: renderWeightedStack },
  B: { name: "Audit worksheet", render: renderAuditWorksheet },
  C: { name: "Evidence-first narrative", render: renderEvidenceNarrative },
};

const state = {
  exportEconomy: "China",
  product: "HS 2012 · 851713 · Smartphones",
  selectedMarket: "TUR",
  comparedMarkets: new Set(["MEX", "TUR"]),
};

const app = document.querySelector("#app");
const variantLabel = document.querySelector("#variant-label");
const statusRegion = document.querySelector("#prototype-status");

function currentVariant() {
  const requested = new URLSearchParams(window.location.search).get("variant");
  return variants[requested] ? requested : "A";
}

function selectedMarket() {
  return markets.find((market) => market.code === state.selectedMarket) ?? markets[0];
}

function scoreFor(market) {
  const weighted = market.components.reduce(
    (total, component) => total + (component.percentile * component.weight) / 100,
    0,
  );
  return Math.floor(weighted + 0.5);
}

function confidenceClass(label) {
  return label.toLowerCase();
}

function ordinal(value) {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}

function relativeStanding(component) {
  if (component.state === "neutral") {
    return "Assigned midpoint (50) - not ranked";
  }
  return `${ordinal(component.percentile)} cohort percentile`;
}

function dataScope() {
  return `
    <section class="data-scope" aria-label="Data scope">
      <div>
        <strong>BACI HS 2012 · V202601</strong>
        <span>Source updated 22 Jan 2026</span>
      </div>
      <div>
        <strong>Score window 2019-2023</strong>
        <span>2024 shown separately as provisional</span>
      </div>
      <details>
        <summary>Latest known release · Source details</summary>
        <p>
          Score version cms-v1 · values in current USD · 2024 is excluded from
          score, rank, stability, and Data Confidence.
        </p>
      </details>
    </section>
  `;
}

function searchPanel() {
  return `
    <aside class="panel search-panel">
      <p class="eyebrow">Define the search</p>
      <label for="export-economy">Export economy</label>
      <select id="export-economy" data-field="exportEconomy">
        ${["China", "Germany", "United States", "Vietnam"]
          .map(
            (economy) =>
              `<option ${economy === state.exportEconomy ? "selected" : ""}>${economy}</option>`,
          )
          .join("")}
      </select>
      <label for="product">HS product</label>
      <select id="product" data-field="product">
        ${[
          "HS 2012 · 851713 · Smartphones",
          "HS 2012 · 850760 · Lithium-ion accumulators",
          "HS 2012 · 940360 · Wooden furniture",
        ]
          .map(
            (product) =>
              `<option ${product === state.product ? "selected" : ""}>${product}</option>`,
          )
          .join("")}
      </select>
      <button class="button" type="button" data-action="update">Update ranking</button>
      <div class="scope-note">
        <strong>How to read the score</strong>
        <p>
          A relative summary of observed markets. It is not a probability,
          forecast, or recommendation.
        </p>
      </div>
    </aside>
  `;
}

function rankingPanel() {
  return `
    <section class="ranking-panel" aria-label="Ranked Candidate Markets">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Observed cohort</p>
          <h2>Ranked Candidate Markets</h2>
          <p>${state.exportEconomy} · ${state.product}</p>
        </div>
        <span class="count-badge">5 shown · 42 cohort</span>
      </div>
      <div class="market-list">
        ${markets
          .map((market) => {
            const selected = market.code === state.selectedMarket;
            return `
              <button
                class="market-card ${selected ? "selected" : ""}"
                type="button"
                data-action="select-market"
                data-market="${market.code}"
                aria-pressed="${selected}"
              >
                <span class="market-rank">#${market.rank}</span>
                <span class="market-name">${market.name}</span>
                <span class="market-score">
                  ${scoreFor(market)}
                  <small>score</small>
                </span>
                <span class="confidence-badge ${confidenceClass(market.confidenceLabel)}">
                  ${market.confidenceLabel} confidence
                </span>
              </button>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function scoreIdentity(market, emphasis = "score") {
  const score = scoreFor(market);
  return `
    <header class="evidence-header ${emphasis}">
      <div>
        <p class="eyebrow">Selected evidence record</p>
        <h2>${market.name}</h2>
        <p>Rank #${market.rank} of 42 observed markets · shared ranks allowed</p>
      </div>
      <div class="score-summary">
        <strong>${score}</strong>
        <span>Candidate Market Score</span>
        <small>integer relative composite</small>
      </div>
    </header>
  `;
}

function provisionalPanel(market) {
  if (!market.provisional.marketValue) {
    return `
      <section class="provisional-panel">
        <div>
          <p class="eyebrow">2024 provisional snapshot</p>
          <h3>No recorded positive flow in the 2024 provisional data</h3>
        </div>
        <p>Supporting evidence only · excluded from score, rank, and Data Confidence.</p>
      </section>
    `;
  }

  return `
    <section class="provisional-panel">
      <div>
        <p class="eyebrow">2024 provisional snapshot</p>
        <h3>Supporting evidence only</h3>
        <p>Excluded from score, rank, and Data Confidence.</p>
      </div>
      <dl>
        <div><dt>World imports</dt><dd>${market.provisional.marketValue}</dd></div>
        <div><dt>Recorded bilateral</dt><dd>${market.provisional.bilateralValue}</dd></div>
        <div><dt>Recorded share</dt><dd>${market.provisional.share}</dd></div>
        <div><dt>Quantity coverage</dt><dd>${market.provisional.quantityCoverage}</dd></div>
      </dl>
    </section>
  `;
}

function confidenceLedger(market, mode = "stack") {
  const deductions =
    market.deductions.length === 0
      ? `<li class="no-deduction"><span>No deductions</span><strong>100</strong></li>`
      : market.deductions
          .map(
            (deduction) => `
              <li>
                <span>${deduction.label}</span>
                <strong>${deduction.points === null ? "cap" : `-${deduction.points}`}</strong>
              </li>
            `,
          )
          .join("");

  return `
    <section class="confidence-ledger ${mode}">
      <div class="confidence-title">
        <div>
          <p class="eyebrow">Separate from rank</p>
          <h3>Data Confidence</h3>
        </div>
        <span class="confidence-value ${confidenceClass(market.confidenceLabel)}">
          ${market.confidenceLabel} · ${market.confidence}
        </span>
      </div>
      <p>How complete and stable is the evidence behind this score?</p>
      <ul>${deductions}</ul>
      <p class="caveat"><strong>Coverage:</strong> ${market.observedYears} finalized years. ${market.caveat}</p>
    </section>
  `;
}

function renderWeightedStack(market) {
  return `
    <article class="panel evidence-panel variant-a">
      ${scoreIdentity(market)}
      <div class="variant-intro">
        <strong>Fixed weights, visible evidence</strong>
        <span>Bars show cohort percentile, not probability or raw magnitude.</span>
      </div>
      <div class="component-stack">
        ${market.components
          .map(
            (component) => `
              <section class="component-row ${component.state}">
                <div class="component-label">
                  <span class="weight-badge">${component.weight}% weight</span>
                  <h3>${component.label}</h3>
                  <strong>${component.raw}</strong>
                  <small>${component.detail}</small>
                </div>
                <div class="percentile-block">
                  <div>
                    <span>Cohort percentile</span>
                    <strong>${component.percentile}</strong>
                  </div>
                  <span class="percentile-track" aria-hidden="true">
                    <span style="width:${component.percentile}%"></span>
                  </span>
                  <p>${component.interpretation}</p>
                  ${
                    component.state === "neutral"
                      ? `<span class="neutral-label">Neutral midpoint · evidence not computed</span>`
                      : ""
                  }
                </div>
              </section>
            `,
          )
          .join("")}
      </div>
      ${confidenceLedger(market)}
      ${provisionalPanel(market)}
      ${evidenceActions(market)}
    </article>
  `;
}

function renderAuditWorksheet(market) {
  return `
    <article class="panel evidence-panel variant-b">
      ${scoreIdentity(market)}
      <section class="formula-banner">
        <div>
          <p class="eyebrow">cms-v1 audit view</p>
          <strong>30% Size + 25% Growth + 25% Foothold + 20% Diversity</strong>
        </div>
        <span>Rounded half-up to the displayed integer score</span>
      </section>
      <div class="audit-grid">
        <section class="audit-table-wrap">
          <h3>Score inputs</h3>
          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th>Raw evidence</th>
                <th>State</th>
                <th>Cohort percentile</th>
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              ${market.components
                .map(
                  (component) => `
                    <tr class="${component.state}">
                      <th>${component.label}</th>
                      <td>
                        <strong>${component.raw}</strong>
                        <small>${component.detail}</small>
                        <small class="audit-interpretation">${component.interpretation}</small>
                      </td>
                      <td>
                        <span class="state-badge ${component.state}">
                          ${component.state === "neutral" ? "Neutral" : "Computed"}
                        </span>
                      </td>
                      <td><strong>${component.percentile}</strong><small>of observed cohort</small></td>
                      <td><strong>${component.weight}%</strong></td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
          <p class="audit-note">
            Intermediate weighted decimals are intentionally not displayed. Equal
            integer scores share a rank.
          </p>
        </section>
        ${confidenceLedger(market, "audit")}
      </div>
      ${provisionalPanel(market)}
      ${evidenceActions(market)}
    </article>
  `;
}

function renderEvidenceNarrative(market) {
  const score = scoreFor(market);
  return `
    <article class="panel evidence-panel variant-c">
      <header class="narrative-header">
        <div>
          <p class="eyebrow">Selected evidence record</p>
          <h2>${market.name} ranks #${market.rank} of 42</h2>
          <p>
            Its evidence produces a Candidate Market Score of <strong>${score}</strong>.
            That is a relative composite, not a forecast or recommendation.
          </p>
        </div>
        <span class="confidence-value ${confidenceClass(market.confidenceLabel)}">
          ${market.confidenceLabel} confidence · ${market.confidence}
        </span>
      </header>
      <section class="narrative-flow" aria-label="How the evidence becomes a score">
        ${market.components
          .map(
            (component, index) => `
              <article class="evidence-story ${component.state}">
                <span class="story-number">${index + 1}</span>
                <div>
                  <p class="story-role">${component.weight}% fixed weight · ${component.label}</p>
                  <h3>${component.raw}</h3>
                  <p>${component.interpretation}</p>
                  <dl>
                    <div><dt>Period and method</dt><dd>${component.detail}</dd></div>
                    <div><dt>Relative standing</dt><dd>${relativeStanding(component)}</dd></div>
                    <div>
                      <dt>Evidence state</dt>
                      <dd>${component.state === "neutral" ? "Neutral midpoint; not computed" : "Computed"}</dd>
                    </div>
                  </dl>
                </div>
              </article>
            `,
          )
          .join("")}
      </section>
      <section class="narrative-confidence">
        <div>
          <p class="eyebrow">Read uncertainty alongside the rank</p>
          <h3>What limits this evidence?</h3>
          <p>${market.caveat}</p>
        </div>
        <ul>
          ${
            market.deductions.length === 0
              ? "<li>No Data Confidence deductions.</li>"
              : market.deductions
                  .map(
                    (deduction) =>
                      `<li>${deduction.label}${deduction.points === null ? "" : ` (-${deduction.points})`}</li>`,
                  )
                  .join("")
          }
        </ul>
      </section>
      ${provisionalPanel(market)}
      ${evidenceActions(market)}
    </article>
  `;
}

function evidenceActions(market) {
  const compared = state.comparedMarkets.has(market.code);
  return `
    <footer class="evidence-actions">
      <button class="button" type="button" data-action="compare" data-market="${market.code}">
        ${compared ? "Remove from comparison" : "Add to comparison"}
      </button>
      <button class="button secondary" type="button" data-action="export">
        Export evidence row
      </button>
    </footer>
  `;
}

function compareTray() {
  const compared = markets.filter((market) => state.comparedMarkets.has(market.code));
  return `
    <section class="compare-tray">
      <div>
        <strong>Comparison tray · ${compared.length}/3</strong>
        <span>
          ${compared.length ? compared.map((market) => market.name).join(" · ") : "No markets selected"}
        </span>
      </div>
      <button class="button secondary" type="button" ${compared.length < 2 ? "disabled" : ""}>
        Compare selected
      </button>
    </section>
  `;
}

function render() {
  const variantKey = currentVariant();
  const variant = variants[variantKey];
  const market = selectedMarket();

  document.title = `HS Tracker prototype - ${variant.name}`;
  variantLabel.textContent = `${variantKey} - ${variant.name}`;
  app.innerHTML = `
    <section class="page">
      <div class="prototype-heading">
        <div>
          <p class="eyebrow">Score presentation prototype · Variant ${variantKey}</p>
          <h1>${variant.name}</h1>
          <p>
            The focused workspace stays fixed. This variant changes how total score,
            components, confidence, missingness, and caveats are explained.
          </p>
        </div>
        <div class="prototype-question">
          <strong>Question being tested</strong>
          <span>Can an analyst understand why a market ranks here without reading the score as false precision?</span>
        </div>
      </div>
      ${dataScope()}
      <div class="workspace-grid">
        ${searchPanel()}
        ${rankingPanel()}
        ${variant.render(market)}
      </div>
      <section class="disclaimer">
        <strong>Discovery aid, not a recommendation.</strong>
        <span>
          Validate customers, competition, regulation, logistics, and margins
          separately. Percentiles compare only the observed cohort for this query.
        </span>
      </section>
      ${compareTray()}
    </section>
  `;

  wirePageEvents();
}

function wirePageEvents() {
  document.querySelectorAll('[data-action="select-market"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedMarket = button.dataset.market;
      render();
    });
  });

  document.querySelector('[data-field="exportEconomy"]')?.addEventListener("change", (event) => {
    state.exportEconomy = event.target.value;
  });

  document.querySelector('[data-field="product"]')?.addEventListener("change", (event) => {
    state.product = event.target.value;
  });

  document.querySelector('[data-action="update"]')?.addEventListener("click", () => {
    statusRegion.textContent = "Illustrative ranking updated.";
    render();
  });

  document.querySelector('[data-action="compare"]')?.addEventListener("click", (event) => {
    const code = event.currentTarget.dataset.market;
    if (state.comparedMarkets.has(code)) {
      state.comparedMarkets.delete(code);
    } else if (state.comparedMarkets.size < 3) {
      state.comparedMarkets.add(code);
    }
    render();
  });

  document.querySelector('[data-action="export"]')?.addEventListener("click", () => {
    statusRegion.textContent =
      "Prototype only. The export contract is decided in a separate Wayfinder ticket.";
  });
}

function switchVariant(direction) {
  const keys = Object.keys(variants);
  const currentIndex = keys.indexOf(currentVariant());
  const nextIndex = (currentIndex + direction + keys.length) % keys.length;
  const url = new URL(window.location.href);
  url.searchParams.set("variant", keys[nextIndex]);
  window.history.replaceState({}, "", url);
  render();
}

document.querySelector('[data-switch="previous"]').addEventListener("click", () => {
  switchVariant(-1);
});

document.querySelector('[data-switch="next"]').addEventListener("click", () => {
  switchVariant(1);
});

window.addEventListener("keydown", (event) => {
  const target = event.target;
  if (
    target.matches("input, textarea, select, [contenteditable='true']") ||
    (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
  ) {
    return;
  }
  switchVariant(event.key === "ArrowRight" ? 1 : -1);
});

window.addEventListener("popstate", render);
render();

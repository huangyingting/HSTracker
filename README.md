# HS Tracker

HS Tracker helps export-oriented businesses interpret public international
merchandise-trade data and identify Candidate Markets for deeper investigation.
It is a discovery aid, not a recommendation or a prediction of commercial
success.

## Local development

The runtime is pinned to Node.js 24.17.0 and npm 11.13.0.

```bash
npm ci
npm run dev
```

The public application is available at `http://localhost:3000`; health is
available at `/healthz`. Set `APP_BUILD_ID` to expose a deployment-safe build
identity in the health response. Local builds report `development` by default.

## Required checks

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

End-to-end tests build and start the standalone production server.

## BACI release staging

Keep the raw archive and generated Parquet outside the repository. The committed
descriptor and annual coverage approval drive the fail-closed staging command:

```bash
npm run stage:baci -- \
  --descriptor data/releases/V202601.source.json \
  --approval data/releases/V202601.coverage-approval.json \
  --workspace /tmp/hs-tracker-baci/V202601-work \
  --report reports/releases/V202601.source-report.json
```

The download resumes from workspace download storage. Pass
`--archive /path/to/BACI_HS12_V202601.zip` to validate an existing local copy.
Accepted runs atomically publish year-partitioned Parquet under the workspace;
coverage drift retains a report but publishes no staging.

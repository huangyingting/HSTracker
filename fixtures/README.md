# Shared fixtures

This directory contains deterministic fixture data shared across application
fixture mode and executable tests.

- `acceptance/v1/` is the versioned, content-addressed acceptance contract used
  by fixture runtime adapters and integration tests.
- `pipeline/v1/` contains tiny synthetic BACI archives and metadata used to
  exercise source-ingestion success and failure paths. These files are not
  production BACI observations.
- `trade-trend/v1/` layers dedicated annual-observation evidence over the
  fixture runtime. It deliberately remains outside the content-identity
  manifest for pristine Candidate Market acceptance fixtures.

Runnable suites belong under `tests/integration/` or `tests/e2e/`. Test-only
builders, readers, and other helper code belong under `tests/support/` rather
than this shared data root.

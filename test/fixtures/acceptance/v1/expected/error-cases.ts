import {
  ACCEPTANCE_FIXTURE_BUILD_IDS,
  FIXTURE_ADAPTER_TEST_BUILD_IDS,
} from "../metadata";

export const ANALYSIS_ROUTE_ERROR_CASES = [
  {
    name: "missing product",
    build: ACCEPTANCE_FIXTURE_BUILD_IDS.core,
    query: "exporter=156",
    status: 400,
    code: "INVALID_ANALYSIS_QUERY",
    message: "The analysis query is invalid.",
  },
  {
    name: "malformed product",
    build: ACCEPTANCE_FIXTURE_BUILD_IDS.core,
    query: "exporter=156&product=10121",
    status: 400,
    code: "INVALID_ANALYSIS_QUERY",
    message: "The analysis query is invalid.",
  },
  {
    name: "unsupported query parameter",
    build: ACCEPTANCE_FIXTURE_BUILD_IDS.core,
    query: "exporter=156&product=010121&window=3",
    status: 400,
    code: "INVALID_ANALYSIS_QUERY",
    message: "The analysis query is invalid.",
  },
  {
    name: "unknown product",
    build: ACCEPTANCE_FIXTURE_BUILD_IDS.core,
    query: "exporter=156&product=999999",
    status: 404,
    code: "UNKNOWN_PRODUCT",
    message: "The requested HS12 product is not available.",
  },
  {
    name: "unknown exporter",
    build: ACCEPTANCE_FIXTURE_BUILD_IDS.core,
    query: "exporter=999&product=010121",
    status: 404,
    code: "UNKNOWN_EXPORTER",
    message: "The requested exporter is not available.",
  },
  {
    name: "retired build",
    build: "retired-fixture-build",
    query: "exporter=156&product=010121",
    status: 410,
    code: "ANALYSIS_BUILD_RETIRED",
    message: "The requested analysis build is no longer served.",
  },
  {
    name: "unavailable build",
    build: FIXTURE_ADAPTER_TEST_BUILD_IDS.unavailable,
    query: "exporter=156&product=010121",
    status: 503,
    code: "ANALYSIS_UNAVAILABLE",
    message: "Candidate Market analysis is temporarily unavailable.",
  },
] as const;

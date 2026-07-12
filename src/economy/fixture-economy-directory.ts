import { ACCEPTANCE_ECONOMIES } from "../../test/fixtures/acceptance/v1/economies/core";
import { ACCEPTANCE_ECONOMY_CAP_RECORDS } from "../../test/fixtures/acceptance/v1/economies/cap";
import {
  ACCEPTANCE_FIXTURE_BUILD_IDS,
  ECONOMY_DIRECTORY_FIXTURE_BUILD_IDS,
  FIXTURE_ADAPTER_TEST_BUILD_IDS,
} from "../../test/fixtures/acceptance/v1/metadata";
import type {
  EconomyDirectory,
  EconomySearchResult,
} from "./economy-directory";
import {
  retiredEconomyDirectory,
  unavailableEconomyDirectory,
} from "./economy-directory-errors";
import {
  normalizeEconomyQuery,
  searchEconomies,
  validateEconomySearchQuery,
} from "./economy-search";

class FixtureEconomyDirectory implements EconomyDirectory {
  async search(
    query: Parameters<EconomyDirectory["search"]>[0],
  ): Promise<EconomySearchResult> {
    validateEconomySearchQuery(query);
    if (query.analysisBuildId === FIXTURE_ADAPTER_TEST_BUILD_IDS.failing) {
      throw new Error("fixture economy directory failure");
    }
    if (query.analysisBuildId === FIXTURE_ADAPTER_TEST_BUILD_IDS.unavailable) {
      throw unavailableEconomyDirectory(query.analysisBuildId);
    }
    if (
      query.analysisBuildId !== ACCEPTANCE_FIXTURE_BUILD_IDS.core &&
      query.analysisBuildId !== ECONOMY_DIRECTORY_FIXTURE_BUILD_IDS.cap
    ) {
      throw retiredEconomyDirectory(query.analysisBuildId);
    }

    const normalizedQuery = normalizeEconomyQuery(query.query);
    const economies =
      query.analysisBuildId === ECONOMY_DIRECTORY_FIXTURE_BUILD_IDS.cap
        ? ACCEPTANCE_ECONOMY_CAP_RECORDS
        : ACCEPTANCE_ECONOMIES;
    const allMatches = searchEconomies(
      economies,
      normalizedQuery,
    );
    const matches = allMatches.slice(0, query.limit);

    return {
      schemaVersion: "economy-search-result-v1",
      analysisBuildId: query.analysisBuildId,
      query: {
        normalized: normalizedQuery,
        limit: query.limit,
      },
      totalMatches: allMatches.length,
      truncated: matches.length < allMatches.length,
      matches,
    };
  }
}

export function createFixtureEconomyDirectory(): EconomyDirectory {
  return new FixtureEconomyDirectory();
}

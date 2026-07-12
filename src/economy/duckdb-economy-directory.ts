import { resolve } from "node:path";

import { DuckDBInstance } from "@duckdb/node-api";

import type {
  EconomyDirectory,
  EconomyRecord,
  EconomySearchResult,
} from "./economy-directory";
import {
  retiredEconomyDirectory,
} from "./economy-directory-errors";
import {
  normalizeEconomyQuery,
  searchEconomies,
  validateEconomySearchQuery,
} from "./economy-search";

type DuckDbEconomyDirectoryOptions = {
  artifactPath: string;
  analysisBuildId: string;
};

export class DuckDbEconomyDirectory implements EconomyDirectory {
  private constructor(
    private readonly analysisBuildId: string,
    private readonly economies: readonly EconomyRecord[],
  ) {}

  static async load(
    options: DuckDbEconomyDirectoryOptions,
  ): Promise<DuckDbEconomyDirectory> {
    const instance = await DuckDBInstance.create(
      resolve(options.artifactPath),
      { access_mode: "READ_ONLY" },
    );
    try {
      const connection = await instance.connect();
      try {
        const result = await connection.runAndReadAll(`
          SELECT code, iso2, iso3, display_name, identity_note
          FROM economy
          WHERE kind = 'ECONOMY'
          ORDER BY code
        `);
        const economies = result
          .getRowObjectsJson()
          .map(toEconomyRecord);
        return new DuckDbEconomyDirectory(
          options.analysisBuildId,
          economies,
        );
      } finally {
        connection.closeSync();
      }
    } finally {
      instance.closeSync();
    }
  }

  async search(
    query: Parameters<EconomyDirectory["search"]>[0],
  ): Promise<EconomySearchResult> {
    validateEconomySearchQuery(query);
    if (query.analysisBuildId !== this.analysisBuildId) {
      throw retiredEconomyDirectory(query.analysisBuildId);
    }

    const normalizedQuery = normalizeEconomyQuery(query.query);
    const allMatches = searchEconomies(
      this.economies,
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

function toEconomyRecord(
  row: Record<string, unknown>,
): EconomyRecord {
  return {
    code: String(nonnegativeInteger(row.code, "economy code")),
    iso2: nullableString(row.iso2, "economy iso2"),
    iso3: nullableString(row.iso3, "economy iso3"),
    name: string(row.display_name, "economy display name"),
    identityNote: nullableString(
      row.identity_note,
      "economy identity note",
    ),
  };
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a nonempty string.`);
  }
  return value;
}

function nullableString(
  value: unknown,
  label: string,
): string | null {
  return value === null ? null : string(value, label);
}

function nonnegativeInteger(value: unknown, label: string): number {
  const parsed =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "number"
        ? value
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a nonnegative safe integer.`);
  }
  return parsed;
}

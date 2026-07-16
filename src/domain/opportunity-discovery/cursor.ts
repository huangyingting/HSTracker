import { createHash } from "node:crypto";

import { invalidOpportunityCursor } from "./errors";

// Opaque keyset cursor for the ordered Market Investigation feed. It carries
// no offset: it authenticates the exact analytical feed (Analysis Identity +
// product projection) and the full canonical order key of the last returned
// candidate, so a cursor minted against a different Dataset Package, export
// economy, or product projection is rejected as INVALID_CURSOR rather than
// silently skewing a page. See recipe doc section 8/9.

const CURSOR_PREFIX = "odc1";

export type OpportunityOrderKey = {
  priorityDisplay: number;
  attractivenessDisplay: number;
  exporterFitDisplay: number;
  productCode: string;
  importerCode: string;
};

export type OpportunityCursorPayload = {
  analysisIdentity: string;
  productFilterDigest: string;
  lastKey: OpportunityOrderKey;
};

// Stable digest of the confirmed product projection. `null` (the canonical
// all-product feed) and any explicit list of codes map to distinct digests,
// and reordering or duplicating the requested codes cannot change it because
// the platform normalizes the projection before this runs.
export function productFilterDigest(
  productCodes: readonly string[] | null,
): string {
  const canonical = JSON.stringify(
    productCodes === null ? { all: true } : { codes: productCodes },
  );
  return createHash("sha256").update(canonical).digest("hex");
}

function orderKeyTuple(key: OpportunityOrderKey): readonly [
  number,
  number,
  number,
  string,
  string,
] {
  return [
    key.priorityDisplay,
    key.attractivenessDisplay,
    key.exporterFitDisplay,
    key.productCode,
    key.importerCode,
  ];
}

function checksum(payload: OpportunityCursorPayload): string {
  const canonical = JSON.stringify([
    CURSOR_PREFIX,
    payload.analysisIdentity,
    payload.productFilterDigest,
    orderKeyTuple(payload.lastKey),
  ]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function encodeOpportunityCursor(
  payload: OpportunityCursorPayload,
): string {
  const body = {
    p: CURSOR_PREFIX,
    a: payload.analysisIdentity,
    f: payload.productFilterDigest,
    k: orderKeyTuple(payload.lastKey),
    c: checksum(payload),
  };
  return `${CURSOR_PREFIX}.${Buffer.from(JSON.stringify(body), "utf8").toString(
    "base64url",
  )}`;
}

export function decodeOpportunityCursor(
  cursor: string,
): OpportunityCursorPayload {
  const [prefix, encoded, ...rest] = cursor.split(".");
  if (prefix !== CURSOR_PREFIX || encoded === undefined || rest.length > 0) {
    throw invalidOpportunityCursor("Cursor is malformed.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw invalidOpportunityCursor("Cursor is not decodable.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw invalidOpportunityCursor("Cursor payload is not an object.");
  }
  const body = parsed as Record<string, unknown>;
  if (
    body.p !== CURSOR_PREFIX ||
    typeof body.a !== "string" ||
    typeof body.f !== "string" ||
    !Array.isArray(body.k) ||
    body.k.length !== 5 ||
    typeof body.c !== "string"
  ) {
    throw invalidOpportunityCursor("Cursor payload is malformed.");
  }
  const [priority, attractiveness, exporterFit, productCode, importerCode] =
    body.k as unknown[];
  if (
    typeof priority !== "number" ||
    typeof attractiveness !== "number" ||
    typeof exporterFit !== "number" ||
    typeof productCode !== "string" ||
    typeof importerCode !== "string"
  ) {
    throw invalidOpportunityCursor("Cursor order key is malformed.");
  }
  const payload: OpportunityCursorPayload = {
    analysisIdentity: body.a,
    productFilterDigest: body.f,
    lastKey: {
      priorityDisplay: priority,
      attractivenessDisplay: attractiveness,
      exporterFitDisplay: exporterFit,
      productCode,
      importerCode,
    },
  };
  if (checksum(payload) !== body.c) {
    throw invalidOpportunityCursor("Cursor integrity check failed.");
  }
  return payload;
}

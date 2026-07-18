import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { gzipResponseWhenRequested } from "../../src/http/response";

const LARGE_BODY = JSON.stringify({
  markets: Array.from({ length: 400 }, (_, index) => ({
    exporter: index,
    label: `candidate-market-${index}`,
    score: index / 400,
  })),
});

const gzipRequest = (): Request =>
  new Request("http://localhost/api/v1/example", {
    headers: { "accept-encoding": "gzip" },
  });

const jsonResponse = (body: string): Response =>
  new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      vary: "Accept-Encoding",
      etag: 'W/"abc123"',
    },
  });

describe("gzipResponseWhenRequested", () => {
  it("gzips a large body when the caller advertises gzip support", async () => {
    const original = jsonResponse(LARGE_BODY);

    const compressed = await gzipResponseWhenRequested(gzipRequest(), original);

    expect(compressed.headers.get("content-encoding")).toBe("gzip");
    const wire = Buffer.from(await compressed.arrayBuffer());
    expect(gunzipSync(wire).toString("utf8")).toBe(LARGE_BODY);
    expect(wire.length).toBeLessThan(Buffer.byteLength(LARGE_BODY));
    expect(compressed.headers.get("content-length")).toBe(String(wire.length));
    expect(compressed.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(compressed.headers.get("vary")).toBe("Accept-Encoding");
    expect(compressed.headers.get("etag")).toBe('W/"abc123"');
  });

  it("leaves the response untouched when gzip is not advertised", async () => {
    const original = jsonResponse(LARGE_BODY);

    const passthrough = await gzipResponseWhenRequested(
      new Request("http://localhost/api/v1/example"),
      original,
    );

    expect(passthrough).toBe(original);
    expect(passthrough.headers.get("content-encoding")).toBeNull();
    expect(await passthrough.text()).toBe(LARGE_BODY);
  });

  it("does not compress bodies below the minimum threshold", async () => {
    const original = jsonResponse("{}");

    const result = await gzipResponseWhenRequested(gzipRequest(), original);

    expect(result.headers.get("content-encoding")).toBeNull();
    expect(await result.text()).toBe("{}");
  });

  it("preserves an already-encoded response", async () => {
    const preEncoded = new Response(LARGE_BODY, {
      status: 200,
      headers: { "content-encoding": "br" },
    });

    const result = await gzipResponseWhenRequested(gzipRequest(), preEncoded);

    expect(result).toBe(preEncoded);
    expect(result.headers.get("content-encoding")).toBe("br");
  });

  it("adds Accept-Encoding to an existing Vary header without duplicating it", async () => {
    const original = new Response(LARGE_BODY, {
      status: 200,
      headers: { vary: "Accept-Language" },
    });

    const result = await gzipResponseWhenRequested(gzipRequest(), original);

    expect(result.headers.get("vary")).toBe("Accept-Language, Accept-Encoding");
  });

  it("treats gzip listed among other codings as accepted", async () => {
    const request = new Request("http://localhost/api/v1/example", {
      headers: { "accept-encoding": "br, gzip;q=0.8" },
    });

    const result = await gzipResponseWhenRequested(
      request,
      jsonResponse(LARGE_BODY),
    );

    expect(result.headers.get("content-encoding")).toBe("gzip");
  });

  it("does not treat identity-only negotiation as gzip support", async () => {
    const request = new Request("http://localhost/api/v1/example", {
      headers: { "accept-encoding": "identity" },
    });

    const result = await gzipResponseWhenRequested(
      request,
      jsonResponse(LARGE_BODY),
    );

    expect(result.headers.get("content-encoding")).toBeNull();
  });
});

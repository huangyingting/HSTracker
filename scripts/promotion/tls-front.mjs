#!/usr/bin/env node
// Loopback TLS-termination front for candidate-class promotion measurements
// (issue #30 / ADR-0004). The promotion HTTP performance runner requires an
// HTTPS origin for candidate evidence (parseMixedLoadPlan / validatePlanOrigin),
// but the local single-host deployment serves plain HTTP on loopback with no
// TLS proxy. This transparently terminates TLS on 127.0.0.1:<port> and forwards
// every request to the plain-HTTP target, preserving method, path, request and
// response headers, and status so identity-assertion headers (x-hs-tracker-*)
// and cache-state probe headers pass through unchanged.
//
// Loopback only: it binds 127.0.0.1 and forwards from 127.0.0.1, so the app
// still sees a loopback client and no client-supplied rate-limit header is
// introduced. It is measurement scaffolding, not part of the deployment.
//
// Usage:
//   node scripts/promotion/tls-front.mjs \
//     --port 3343 --target http://127.0.0.1:3300 \
//     --cert .local-tls/cert.pem --key .local-tls/key.pem

import { createServer } from "node:https";
import { request as httpRequest } from "node:http";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    port: { type: "string" },
    target: { type: "string" },
    cert: { type: "string" },
    key: { type: "string" },
  },
});

const port = Number.parseInt(values.port ?? "3343", 10);
const target = new URL(values.target ?? "http://127.0.0.1:3300");
const certPath = values.cert ?? ".local-tls/cert.pem";
const keyPath = values.key ?? ".local-tls/key.pem";

if (target.protocol !== "http:") {
  throw new Error("--target must be a plain-HTTP loopback origin.");
}

const server = createServer(
  { cert: readFileSync(certPath), key: readFileSync(keyPath) },
  (clientReq, clientRes) => {
    const upstream = httpRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method: clientReq.method,
        path: clientReq.url,
        headers: { ...clientReq.headers, host: target.host },
      },
      (upstreamRes) => {
        clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(clientRes);
      },
    );
    upstream.on("error", (error) => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { "content-type": "text/plain" });
      }
      clientRes.end(`tls-front upstream error: ${error.message}`);
    });
    clientReq.pipe(upstream);
  },
);

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `tls-front listening on https://127.0.0.1:${port} -> ${target.origin}\n`,
  );
});

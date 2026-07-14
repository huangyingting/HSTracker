import { describe, expect, it } from "vitest";

import { createAnonymousSourceHttpAdapter } from "../../src/http/anonymous-source-adapter";

describe("anonymous source HTTP adapter", () => {
  it("derives a stable opaque key only from the explicitly trusted forwarded source", () => {
    const adapter = createAnonymousSourceHttpAdapter({
      trustedProxy: {
        clientAddressHeader: "x-forwarded-for",
        trustedProxyHops: 1,
      },
      secret: "test-only-anonymous-source-secret",
    });

    const trusted = adapter.executionOptions(
      new Request("http://localhost", {
        headers: {
          "X-Forwarded-For": "198.51.100.11, 203.0.113.7",
          "X-Real-IP": "203.0.113.199",
        },
      }),
    );
    const sameTrustedSource = adapter.executionOptions(
      new Request("http://localhost", {
        headers: {
          "X-Forwarded-For":
            "198.51.100.12, 198.51.100.11, 203.0.113.7",
          "X-Real-IP": "198.51.100.12",
        },
      }),
    );

    expect(trusted.anonymousSource).toBe(sameTrustedSource.anonymousSource);
    expect(String(trusted.anonymousSource)).toMatch(
      /^anonymous-source-v1-[a-f0-9]{64}$/u,
    );
    expect(String(trusted.anonymousSource)).not.toContain("203.0.113.7");
    expect(String(trusted.anonymousSource)).not.toContain("198.51.100.11");
  });

  it("ignores spoofed forwarding headers that are not explicitly trusted", () => {
    const adapter = createAnonymousSourceHttpAdapter({
      trustedProxy: {
        clientAddressHeader: "x-hs-tracker-client-address",
        trustedProxyHops: 0,
      },
      secret: "test-only-anonymous-source-secret",
    });

    const spoofed = adapter.executionOptions(
      new Request("http://localhost", {
        headers: { "X-Forwarded-For": "198.51.100.11" },
      }),
    );
    const noHeaders = adapter.executionOptions(new Request("http://localhost"));

    expect(spoofed.anonymousSource).toBe(noHeaders.anonymousSource);
    expect(String(spoofed.anonymousSource)).not.toContain("198.51.100.11");
  });

  it("does not trust forwarding headers until a proxy is explicitly configured", () => {
    const adapter = createAnonymousSourceHttpAdapter({
      trustedProxy: null,
      secret: "test-only-anonymous-source-secret",
    });

    const spoofed = adapter.executionOptions(
      new Request("http://localhost", {
        headers: { "X-Forwarded-For": "198.51.100.11" },
      }),
    );
    const noHeaders = adapter.executionOptions(new Request("http://localhost"));

    expect(spoofed.anonymousSource).toBe(noHeaders.anonymousSource);
  });

  it("uses Fly's proxy-owned client header without trusting X-Forwarded-For", () => {
    const adapter = createAnonymousSourceHttpAdapter({
      trustedProxy: {
        clientAddressHeader: "fly-client-ip",
        trustedProxyHops: 0,
      },
      secret: "test-only-anonymous-source-secret",
    });

    const first = adapter.executionOptions(
      new Request("http://localhost", {
        headers: {
          "Fly-Client-IP": "198.51.100.21",
          "X-Forwarded-For": "203.0.113.1",
        },
      }),
    );
    const second = adapter.executionOptions(
      new Request("http://localhost", {
        headers: {
          "Fly-Client-IP": "198.51.100.22",
          "X-Forwarded-For": "203.0.113.1",
        },
      }),
    );

    expect(first.anonymousSource).not.toBe(second.anonymousSource);
  });
});

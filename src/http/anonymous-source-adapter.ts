import type { AnalysisExecutionOptions } from "../domain/trade-analytics/trade-analytics-platform";
import { anonymousSourceIdentity } from "../runtime/anonymous-source";

export type TrustedProxySourceConfiguration = Readonly<{
  clientAddressHeader: string;
  trustedProxyHops: number;
}>;

export type AnonymousSourceHttpAdapterOptions = Readonly<{
  trustedProxy: TrustedProxySourceConfiguration | null;
  secret?: string | Uint8Array;
}>;

export function createAnonymousSourceHttpAdapter({
  trustedProxy,
  secret,
}: AnonymousSourceHttpAdapterOptions): {
  executionOptions(request: Request): Pick<
    AnalysisExecutionOptions,
    "anonymousSource"
  >;
} {
  if (trustedProxy !== null) {
    validateTrustedProxyConfiguration(trustedProxy);
  }
  return {
    executionOptions(request) {
      const source =
        (trustedProxy === null
          ? null
          : trustedClientAddress(request.headers, trustedProxy)) ??
        "unattributed-anonymous-source";
      return {
        anonymousSource: anonymousSourceIdentity(source, secret),
      };
    },
  };
}

function trustedClientAddress(
  headers: Headers,
  trustedProxy: TrustedProxySourceConfiguration,
): string | null {
  const values = headers
    .get(trustedProxy.clientAddressHeader)
    ?.split(",")
    .map((value) => value.trim());
  if (values === undefined) {
    return null;
  }
  const index = values.length - trustedProxy.trustedProxyHops - 1;
  const address = values[index];
  return address !== undefined && isSafeAddress(address) ? address : null;
}

function validateTrustedProxyConfiguration(
  trustedProxy: TrustedProxySourceConfiguration,
): void {
  if (
    !/^[a-z0-9-]{1,64}$/iu.test(
      trustedProxy.clientAddressHeader,
    ) ||
    !Number.isSafeInteger(trustedProxy.trustedProxyHops) ||
    trustedProxy.trustedProxyHops < 0 ||
    trustedProxy.trustedProxyHops > 8
  ) {
    throw new TypeError("Trusted proxy source configuration is invalid.");
  }
}

function isSafeAddress(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9:.[\]-]+$/u.test(value)
  );
}

import { createHmac, randomBytes } from "node:crypto";

declare const anonymousSourceBrand: unique symbol;

export type AnonymousSourceIdentity = string & {
  readonly [anonymousSourceBrand]: true;
};

type AnonymousSourceSecret = string | Uint8Array;

const defaultSecret = randomBytes(32);

export function anonymousSourceIdentity(
  source: string,
  secret: AnonymousSourceSecret = defaultSecret,
): AnonymousSourceIdentity {
  const digest = createHmac("sha256", secret).update(source).digest("hex");
  return `anonymous-source-v1-${digest}` as AnonymousSourceIdentity;
}

import type { RenderedAlertMessage } from "./alert-message";

export type AlertDeliveryProviderOutcome =
  | "ACCEPTED"
  | "TRANSIENT_FAILURE"
  | "PERMANENT_FAILURE"
  | "BOUNCE"
  | "COMPLAINT";

export interface AlertDeliveryProviderResult {
  readonly accepted: boolean;
  readonly providerReceipt: string | null;
  readonly outcome: AlertDeliveryProviderOutcome;
}

export interface AlertDeliveryProvider {
  readonly supportsIdempotency: boolean;

  send(
    message: RenderedAlertMessage,
    idempotencyKey: string,
  ): Promise<AlertDeliveryProviderResult>;
}

import type {
  AlertDeliveryProvider,
  AlertDeliveryProviderOutcome,
  AlertDeliveryProviderResult,
} from "./alert-delivery-provider";
import type { RenderedAlertMessage } from "./alert-message";

export interface FixtureAlertDeliveryProviderOptions {
  readonly supportsIdempotency: boolean;
}

export interface FixtureAlertDeliveryCall extends AlertDeliveryProviderResult {
  readonly idempotencyKey: string;
  readonly message: RenderedAlertMessage;
  readonly duplicateSuppressed: boolean;
}

interface ScriptedOutcome {
  readonly outcome: AlertDeliveryProviderOutcome;
  readonly providerReceipt: string | null;
}

export class FixtureAlertDeliveryProvider implements AlertDeliveryProvider {
  readonly supportsIdempotency: boolean;
  readonly calls: FixtureAlertDeliveryCall[] = [];
  private readonly script: ScriptedOutcome[] = [];
  private readonly acceptedReceiptsByKey = new Map<string, string | null>();

  constructor(options: FixtureAlertDeliveryProviderOptions) {
    this.supportsIdempotency = options.supportsIdempotency;
  }

  enqueue(
    outcome: AlertDeliveryProviderOutcome,
    providerReceipt: string | null = `${outcome.toLocaleLowerCase("und")}-receipt`,
  ): void {
    this.script.push({ outcome, providerReceipt });
  }

  async send(
    message: RenderedAlertMessage,
    idempotencyKey: string,
  ): Promise<AlertDeliveryProviderResult> {
    if (
      this.supportsIdempotency &&
      this.acceptedReceiptsByKey.has(idempotencyKey)
    ) {
      const result = {
        accepted: false,
        providerReceipt: this.acceptedReceiptsByKey.get(idempotencyKey) ?? null,
        outcome: "ACCEPTED" as const,
      };
      this.calls.push({
        ...result,
        idempotencyKey,
        message,
        duplicateSuppressed: true,
      });
      return result;
    }

    const scripted = this.script.shift() ?? {
      outcome: "ACCEPTED" as const,
      providerReceipt: "accepted-receipt",
    };
    const result = {
      accepted: scripted.outcome === "ACCEPTED",
      providerReceipt: scripted.providerReceipt,
      outcome: scripted.outcome,
    };
    if (result.accepted && this.supportsIdempotency) {
      this.acceptedReceiptsByKey.set(idempotencyKey, result.providerReceipt);
    }
    this.calls.push({
      ...result,
      idempotencyKey,
      message,
      duplicateSuppressed: false,
    });
    return result;
  }
}

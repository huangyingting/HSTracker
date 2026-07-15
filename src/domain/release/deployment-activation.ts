export const RESIDENT_ACTIVATION_FALLBACK_REASONS = [
  "OBJECT_STORE_UNAVAILABLE",
  "CURRENT_DEPLOYMENT_INVALID",
] as const;

export type ResidentActivationFallbackReason =
  (typeof RESIDENT_ACTIVATION_FALLBACK_REASONS)[number];

export type DeploymentActivationMode =
  | "CURRENT"
  | "LAST_VERIFIED_RESIDENT_FALLBACK";

export type DeploymentActivation =
  | { readonly mode: "CURRENT" }
  | {
      readonly mode: "LAST_VERIFIED_RESIDENT_FALLBACK";
      readonly reason: ResidentActivationFallbackReason;
    };

export type PublicDeploymentActivation = Readonly<{
  mode: DeploymentActivationMode;
  fallbackReason: ResidentActivationFallbackReason | null;
}>;

export function publicDeploymentActivation(
  activation: DeploymentActivation,
): PublicDeploymentActivation {
  return {
    mode: activation.mode,
    fallbackReason:
      activation.mode === "LAST_VERIFIED_RESIDENT_FALLBACK"
        ? activation.reason
        : null,
  };
}

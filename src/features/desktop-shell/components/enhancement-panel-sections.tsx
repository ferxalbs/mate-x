/**
 * Barrel — re-exports all public symbols from the modularized sub-files.
 * Callers import from this file; internal structure is an implementation detail.
 */

// View discriminant type
export type EnhancementView =
  | "status"
  | "review"
  | "details"
  | "advanced"
  | "trace"
  | "impact"
  | "validation"
  | "evidence";

// Trust Gate
export { TrustGateCard, ShipStatusStrip } from "./enhancement-panel-trust-gate";

// Sections
export { ReviewQueueSection } from "./enhancement-panel-review";
export { DetailsSection } from "./enhancement-panel-details";
export { ImpactSection } from "./enhancement-panel-impact";
export { ValidationSection } from "./enhancement-panel-validation";
export { EvidencePackSection } from "./enhancement-panel-evidence";
export { RepoHealthSection } from "./enhancement-panel-health";

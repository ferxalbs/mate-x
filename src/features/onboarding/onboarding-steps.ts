import type { Transition, Variants } from "framer-motion";

export type OnboardingStepId =
  | "welcome"
  | "preferences"
  | "privacy"
  | "api-key"
  | "workspace"
  | "trust"
  | "verification";

export interface OnboardingStepDefinition {
  id: OnboardingStepId;
  title: string;
  description: string;
  cta: string;
}

export const ONBOARDING_STEPS: readonly OnboardingStepDefinition[] = [
  {
    id: "welcome",
    title: "Welcome to MaTE X",
    description: "Set up a governed local workspace in a few focused steps.",
    cta: "Get started",
  },
  {
    id: "preferences",
    title: "Choose your appearance",
    description: "System is the recommended default. You can change this anytime.",
    cta: "Save appearance",
  },
  {
    id: "privacy",
    title: "Prepare local privacy checks",
    description: "Install the optional local model now or continue with built-in checks.",
    cta: "Continue",
  },
  {
    id: "api-key",
    title: "Connect Rainy API",
    description: "Add your own key for AI reasoning and repository embeddings.",
    cta: "Continue",
  },
  {
    id: "workspace",
    title: "Choose a repository",
    description: "MaTE X analyzes one local workspace at a time.",
    cta: "Select repository",
  },
  {
    id: "trust",
    title: "Set the workspace boundary",
    description: "Choose how changes are approved inside the selected repository.",
    cta: "Save boundary",
  },
  {
    id: "verification",
    title: "Ready for the first review",
    description: "Finish setup and start from your selected repository.",
    cta: "Open MaTE X",
  },
];

export type OnboardingOperationState = "idle" | "saving" | "error";

export function getOnboardingMotion(
  reducedMotion: boolean,
  direction: number,
): { variants: Variants; transition: Transition } {
  if (reducedMotion) {
    return {
      variants: {
        enter: { opacity: 0 },
        center: { opacity: 1 },
        exit: { opacity: 0 },
      },
      transition: { duration: 0.15, ease: "easeOut" },
    };
  }

  return {
    variants: {
      enter: { opacity: 0, x: direction >= 0 ? 12 : -12 },
      center: { opacity: 1, x: 0 },
      exit: { opacity: 0, x: direction >= 0 ? -12 : 12 },
    },
    transition: {
      duration: 0.22,
      ease: [0.2, 0.8, 0.2, 1],
    },
  };
}

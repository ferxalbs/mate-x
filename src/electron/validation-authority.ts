import type {
  ValidationPlan,
  ValidationRequirementId,
  ValidationUnavailableCause,
} from '../contracts/workspace';
import {
  findValidationPlanCommand,
  isValidationLikeCommand,
  normalizeValidationCommand,
  validationRequirementForCommand,
} from './validation-command';
import {
  collectRepositoryToolchainProfile,
  type RepositoryToolchainProfile,
} from './repository-toolchain';

export type ValidationInvocationAuthorization = 'planned' | 'approved_override';

export interface ValidationInvocationDecision {
  allowed: boolean;
  authorization?: ValidationInvocationAuthorization;
  requirementId: ValidationRequirementId;
  command: string;
  planMatch?: string;
  targetToolchain?: RepositoryToolchainProfile;
  cause?: ValidationUnavailableCause;
  reason?: string;
  recommendedNextAction?: string;
}

/**
 * Resolves validation authority before any executable lookup or process spawn.
 * Policy approval may authorize one exact fallback operation, but never turns
 * an unverified command into repository evidence.
 */
export async function authorizeValidationInvocation(input: {
  command: string;
  workspacePath: string;
  validationPlan?: ValidationPlan | null;
  approvedPolicyStopId?: string;
}): Promise<ValidationInvocationDecision> {
  const requirementId = validationRequirementForCommand(input.command);
  if (!isValidationLikeCommand(input.command)) {
    return {
      allowed: true,
      requirementId,
      command: input.command,
    };
  }

  const planMatch = findValidationPlanCommand(input.command, input.validationPlan);
  let targetToolchain: RepositoryToolchainProfile | undefined;
  try {
    targetToolchain = await collectRepositoryToolchainProfile({
      root: input.workspacePath,
      changedFiles: input.validationPlan?.changedFiles ?? [],
    });
  } catch {
    targetToolchain = undefined;
  }

  const targetCommand = requirementId === 'validation'
    ? undefined
    : targetToolchain?.commands[requirementId]?.command;
  const matchesTarget = Boolean(
    targetCommand &&
    normalizeValidationCommand(targetCommand) === normalizeValidationCommand(input.command),
  );

  if (planMatch && (matchesTarget || (!targetCommand && requirementId === 'validation'))) {
    return {
      allowed: true,
      authorization: 'planned',
      requirementId,
      command: input.command,
      planMatch: planMatch.slot,
      targetToolchain,
    };
  }

  if (input.approvedPolicyStopId) {
    return {
      allowed: true,
      authorization: 'approved_override',
      requirementId,
      command: input.command,
      planMatch: planMatch?.slot,
      targetToolchain,
      cause: targetToolchain?.cause,
      reason: 'The exact validation operation was approved by the active policy stop.',
    };
  }

  const cause = targetToolchain?.cause ??
    (planMatch ? 'VALIDATION_COMMAND_UNRESOLVED' : 'VALIDATION_COMMAND_UNRESOLVED');
  const targetDescription = targetCommand
    ? `Current target command is ${targetCommand}.`
    : 'The target repository has no resolved command for this requirement.';
  return {
    allowed: false,
    requirementId,
    command: input.command,
    planMatch: planMatch?.slot,
    targetToolchain,
    cause,
    reason: planMatch
      ? `The persisted validation plan is stale. ${targetDescription}`
      : `No current resolved validation plan matches this command. ${targetDescription}`,
    recommendedNextAction: cause === 'TOOLCHAIN_AMBIGUOUS'
      ? 'Resolve conflicting target-repository package-manager metadata, then run plan_validation again.'
      : cause === 'TYPECHECK_UNAVAILABLE'
        ? 'Add a repository typecheck script or local TypeScript dependency, then run plan_validation again.'
        : 'Run plan_validation and execute only its exact resolved command. If the requirement remains unresolved, request explicit approval for a fallback.',
  };
}

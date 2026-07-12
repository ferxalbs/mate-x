/**
 * Production agent adapter wiring.
 * Fake adapter is test-only; production must inject Rainy runner.
 * NES-4 / CLOSURE 1
 */

import { RainyAgentAdapter, type AgentAdapter } from './rainy-adapter';
import {
  createProductionRainyRunner,
  type ProductionRainyRunnerDeps,
  type RainyTransport,
} from './rainy-production-runner';

let productionAdapter: AgentAdapter | null = null;
let productionInitialized = false;

export function isProductionAgentAdapterInitialized(): boolean {
  return productionInitialized && productionAdapter !== null;
}

/**
 * Initialize the real Rainy-backed adapter for production.
 * Requires explicit credential resolver — never silent scaffold success.
 */
export function initProductionAgentAdapter(
  deps: ProductionRainyRunnerDeps & {
    transport?: RainyTransport;
  },
): AgentAdapter {
  const runner = createProductionRainyRunner(deps);
  const adapter = new RainyAgentAdapter({
    kind: 'production',
    rainyRunner: runner,
  });
  productionAdapter = adapter;
  productionInitialized = true;
  return adapter;
}

/**
 * Test/advanced injection. Does not mark production unless options.production.
 */
export function setAgentAdapter(
  adapter: AgentAdapter,
  options?: { production?: boolean },
): void {
  productionAdapter = adapter;
  productionInitialized = options?.production === true;
}

export function getAgentAdapter(): AgentAdapter {
  if (!productionAdapter) {
    throw new Error(
      'AgentAdapter not initialized — production must call initProductionAgentAdapter (no scaffold fallback)',
    );
  }
  return productionAdapter;
}

export function resetAgentAdapterForTests(): void {
  productionAdapter = null;
  productionInitialized = false;
}

/**
 * Resolve Rainy API key from environment (never logs the value).
 */
export function resolveRainyApiKeyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const key =
    env.RAINY_API_KEY?.trim() ||
    env.MATE_X_RAINY_API_KEY?.trim() ||
    env.OPENAI_API_KEY?.trim() ||
    '';
  return key.length > 0 ? key : null;
}

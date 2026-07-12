/**
 * Engineering repository wiring.
 * Production authority: LibSqlEngineeringRepository (durable Turso/libSQL).
 * In-memory: test adapter only — never silent production fallback.
 * NES-1.2 / R1
 */

import type { EngineeringRepository as EngineeringRepositoryPort } from './repository-types';
import { EngineeringRepositoryError } from './repository-types';
import { InMemoryEngineeringRepository } from './in-memory-repository';
import { LibSqlEngineeringRepository } from './libsql-repository';

export type {
  EngineeringRepository,
  EngineeringTaskBundle,
  ApplyTransactionInput,
} from './repository-types';
export { EngineeringRepositoryError } from './repository-types';
export { InMemoryEngineeringRepository } from './in-memory-repository';
export { LibSqlEngineeringRepository } from './libsql-repository';

let defaultRepo: EngineeringRepositoryPort | null = null;
let productionDurable = false;

export function isEngineeringRepositoryInitialized(): boolean {
  return defaultRepo !== null;
}

export function isProductionDurableRepository(): boolean {
  return productionDurable && defaultRepo instanceof LibSqlEngineeringRepository;
}

/**
 * Production init — opens durable libSQL DB. Fail closed on error.
 * Never falls back to in-memory.
 */
export function initDurableEngineeringRepository(
  dbPath: string,
): LibSqlEngineeringRepository {
  try {
    const repo = LibSqlEngineeringRepository.open(dbPath);
    defaultRepo = repo;
    productionDurable = true;
    return repo;
  } catch (error) {
    defaultRepo = null;
    productionDurable = false;
    throw new EngineeringRepositoryError(
      `Failed to initialize durable EngineeringRepository: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'ERR_DB_FAILURE',
    );
  }
}

/**
 * Inject a repository (tests or advanced wiring). Marks durable when LibSQL.
 */
export function setEngineeringRepository(
  repo: EngineeringRepositoryPort,
  options?: { productionDurable?: boolean },
): void {
  defaultRepo = repo;
  productionDurable =
    options?.productionDurable === true ||
    repo instanceof LibSqlEngineeringRepository;
}

/**
 * Process authority accessor. Fail closed if never initialized.
 * Production path must call initDurableEngineeringRepository first.
 */
export function getEngineeringRepository(): EngineeringRepositoryPort {
  if (!defaultRepo) {
    throw new EngineeringRepositoryError(
      'EngineeringRepository not initialized — fail closed (no in-memory fallback)',
      'ERR_NOT_INITIALIZED',
    );
  }
  return defaultRepo;
}

/** Test-only: explicit in-memory adapter as process default. */
export function resetEngineeringRepositoryForTests(): InMemoryEngineeringRepository {
  const repo = new InMemoryEngineeringRepository();
  repo.ensureSchema();
  defaultRepo = repo;
  productionDurable = false;
  return repo;
}

export function clearEngineeringRepositoryForTests(): void {
  if (defaultRepo && typeof defaultRepo.close === 'function') {
    try {
      defaultRepo.close();
    } catch {
      // ignore
    }
  }
  defaultRepo = null;
  productionDurable = false;
}

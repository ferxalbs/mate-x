export const IPC = {
  ORCHESTRATOR_RUN: 'orchestrator:run',
  ORCHESTRATOR_ROUTING: 'orchestrator:routing',
  EVIDENCE_PACK_LIST: 'evidence-pack:list',
  EVIDENCE_PACK_PUBLISH: 'evidence-pack:publish',
  FAILURE_MEMORY_SYNC: 'failure-memory:sync',
  FAILURE_MEMORY_EXPORT: 'failure-memory:export',
  FAILURE_MEMORY_IMPORT: 'failure-memory:import',
  CONFIG_GET: 'config:get',
  STORAGE_LIST: 'storage:list',
} as const;

export type IpcChannel = typeof IPC[keyof typeof IPC];

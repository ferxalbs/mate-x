export const IPC = {
  ORCHESTRATOR_RUN: 'mate-x:orchestrator:execute',
  ORCHESTRATOR_ROUTING: 'mate-x:orchestrator:routing',
  EVIDENCE_PACK_LIST: 'mate-x:storage:list-packs',
  EVIDENCE_PACK_PUBLISH: 'evidence-pack:publish',
  FAILURE_MEMORY_SYNC: 'mate-x:storage:force-sync',
  FAILURE_MEMORY_STATUS: 'mate-x:storage:sync-status',
  FAILURE_MEMORY_EXPORT: 'failure-memory:export',
  FAILURE_MEMORY_IMPORT: 'failure-memory:import',
  CONFIG_GET: 'config:get',
  STORAGE_LIST: 'storage:list',
} as const;

export type IpcChannel = typeof IPC[keyof typeof IPC];

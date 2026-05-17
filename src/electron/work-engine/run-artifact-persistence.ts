import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { exportSanitizedWorkEngineRunArtifact, type WorkEngineRunArtifact } from "./run-artifact";

export function resolveWorkEngineRunArtifactPath(input: {
  appDataRoot: string;
  runId: string;
}) {
  return path.join(input.appDataRoot, "work-engine-runs", `${safeFileName(input.runId)}.json`);
}

export async function persistWorkEngineRunArtifact(input: {
  appDataRoot: string;
  artifact: WorkEngineRunArtifact;
}) {
  const artifactPath = resolveWorkEngineRunArtifactPath({
    appDataRoot: input.appDataRoot,
    runId: input.artifact.runId,
  });
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(
    artifactPath,
    `${JSON.stringify(exportSanitizedWorkEngineRunArtifact(input.artifact), null, 2)}\n`,
    "utf8",
  );
  return artifactPath;
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "work-engine-run";
}

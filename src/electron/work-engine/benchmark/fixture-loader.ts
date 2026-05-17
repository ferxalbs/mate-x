import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const FIXTURE_ROOT = path.resolve(
  process.cwd(),
  "src/electron/work-engine/benchmark/fixtures",
);

export interface LoadedFixtureRepo {
  name: string;
  sourcePath: string;
  workspacePath: string;
  cleanup: () => Promise<void>;
}

export async function loadFixtureRepo(name: string): Promise<LoadedFixtureRepo> {
  const sourcePath = path.join(FIXTURE_ROOT, name);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), `matex-${name}-`));
  const workspacePath = path.join(tempRoot, name);
  await cp(sourcePath, workspacePath, {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
  });

  return {
    name,
    sourcePath,
    workspacePath,
    cleanup: () => rm(tempRoot, { recursive: true, force: true }),
  };
}

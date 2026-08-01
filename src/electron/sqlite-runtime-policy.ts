export interface SqliteRuntimePolicy {
  version: string;
  journalMode: "WAL" | "DELETE";
  concurrentWritersQualified: boolean;
  reason: string;
}

const QUALIFIED_WAL_RESET_FIX = [3, 50, 2] as const;

export function resolveSqliteRuntimePolicy(version: string): SqliteRuntimePolicy {
  const parsed = version
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10));
  const valid =
    parsed.length === 3 && parsed.every((part) => Number.isInteger(part) && part >= 0);
  const qualified =
    valid && compareVersion(parsed as [number, number, number], QUALIFIED_WAL_RESET_FIX) >= 0;

  return {
    version,
    journalMode: qualified ? "WAL" : "DELETE",
    concurrentWritersQualified: qualified,
    reason: qualified
      ? "Embedded SQLite includes the qualified WAL-reset fix."
      : "Embedded SQLite is not qualified for concurrent WAL writers; rollback journal serialization is enforced.",
  };
}

function compareVersion(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
) {
  for (let index = 0; index < 3; index++) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

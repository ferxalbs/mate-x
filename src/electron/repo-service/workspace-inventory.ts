import path from "node:path";

export function compareWorkspaceInventoryPaths(left: string, right: string) {
  const rank = (file: string) => {
    const basename = path.basename(file);
    const depth = file.split("/").length - 1;
    if (
      depth === 0 &&
      /^(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod|deno\.jsonc?|README(?:\..+)?|AGENTS\.md|CLAUDE\.md)$/i.test(basename)
    ) return 0;
    if (
      depth === 0 &&
      /^(?:main|index|app|server|cli|renderer|preload)\.(?:[cm]?[jt]sx?|py|rs|go)$/i.test(basename)
    ) return 1;
    if (/^(?:docs\/)?[^/]*(?:architecture|overview)[^/]*\.md$/i.test(file)) return 2;
    if (/^(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod|deno\.jsonc?|README(?:\..+)?)$/i.test(basename)) return 3;
    if (/^(?:main|index|app|server|cli|renderer|preload)\.(?:[cm]?[jt]sx?|py|rs|go)$/i.test(basename)) return 4;
    return 5;
  };
  return rank(left) - rank(right) ||
    left.split("/").length - right.split("/").length ||
    left.localeCompare(right);
}

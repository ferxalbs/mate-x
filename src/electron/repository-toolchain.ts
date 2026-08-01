import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

export type TargetPackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn' | 'deno';
export type ToolchainResolutionCause = 'TOOLCHAIN_AMBIGUOUS' | 'TYPECHECK_UNAVAILABLE';

export interface RepositoryToolchainScope {
  path: string;
  packageJson?: string | null;
  lockfiles: string[];
  denoConfig?: string | null;
  yarnBerry?: boolean;
  localTypeScriptInstalled: boolean;
}

export interface RepositoryToolchainProfile {
  packagePath: string;
  manager: TargetPackageManager | null;
  managerSource: string | null;
  status: 'resolved' | 'ambiguous' | 'unavailable';
  cause?: ToolchainResolutionCause;
  typecheck: {
    command: string | null;
    source: 'script' | 'local_toolchain' | 'deno' | null;
    guarantee: 'local_only_no_install' | null;
  };
}

export interface PackageManagerAdapter {
  script(name: string, packagePath: string, repositoryRoot: string): string;
  localTypecheck(packagePath: string, repositoryRoot: string): string;
}

export class ValidationCommandResolver {
  resolve(scopes: RepositoryToolchainScope[], changedFiles: string[] = []) {
    return resolveRepositoryToolchainProfile(scopes, changedFiles);
  }
}

export const validationCommandResolver = new ValidationCommandResolver();

const LOCKFILE_MANAGERS: Record<string, TargetPackageManager> = {
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
};

export async function collectRepositoryToolchainProfile(input: {
  root: string;
  changedFiles: string[];
}): Promise<RepositoryToolchainProfile> {
  const scopePaths = owningScopePaths(input.root, input.changedFiles);
  const scopes = await Promise.all(scopePaths.map(loadScope));
  return validationCommandResolver.resolve(scopes, input.changedFiles);
}

export function resolveRepositoryToolchainProfile(
  scopes: RepositoryToolchainScope[],
  changedFiles: string[] = [],
): RepositoryToolchainProfile {
  const packageScope = scopes.find((scope) => Boolean(scope.packageJson || scope.denoConfig)) ?? scopes[0];
  if (!packageScope) return unavailable('.', 'TYPECHECK_UNAVAILABLE');

  const managerResolution = resolveManager(scopes);
  if (managerResolution.status === 'ambiguous') {
    return {
      ...unavailable(packageScope.path, 'TOOLCHAIN_AMBIGUOUS'),
      status: 'ambiguous',
    };
  }
  const manager = managerResolution.manager;
  if (!manager) return unavailable(packageScope.path, 'TYPECHECK_UNAVAILABLE');

  if (manager === 'deno') {
    const targets = changedFiles
      .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
      .map(quoteArgument);
    return resolvedProfile(
      packageScope.path,
      manager,
      managerResolution.source,
      `deno check ${targets.length > 0 ? targets.join(' ') : '.'}`,
      'deno',
    );
  }

  const scriptScope = scopes.find((scope) => readPackage(scope.packageJson)?.scripts.typecheck);
  const repositoryRoot = scopes.at(-1)?.path ?? packageScope.path;
  if (scriptScope) {
    const script = readPackage(scriptScope.packageJson)?.scripts.typecheck;
    if (script && isLocalOnlyScript(script)) {
      return resolvedProfile(
        scriptScope.path,
        manager,
        managerResolution.source,
        adapter(manager, managerResolution.version).script('typecheck', scriptScope.path, repositoryRoot),
        'script',
      );
    }
  }

  const declaredScope = scopes.find((scope) => declaresTypeScript(scope.packageJson));
  const installedScope = scopes.find((scope) => scope.localTypeScriptInstalled);
  if (!declaredScope || !installedScope) {
    return unavailable(packageScope.path, 'TYPECHECK_UNAVAILABLE', manager, managerResolution.source);
  }

  return resolvedProfile(
    declaredScope.path,
    manager,
    managerResolution.source,
    adapter(manager, managerResolution.version).localTypecheck(declaredScope.path, repositoryRoot),
    'local_toolchain',
  );
}

function resolveManager(scopes: RepositoryToolchainScope[]): {
  status: 'resolved' | 'ambiguous' | 'unavailable';
  manager: TargetPackageManager | null;
  source: string | null;
  version?: string;
} {
  for (const scope of scopes) {
    if (scope.denoConfig && !scope.packageJson && scope.lockfiles.length === 0) {
      return { status: 'resolved', manager: 'deno', source: `${scope.path}/deno.json` };
    }
    const pkg = readPackage(scope.packageJson);
    const declared = parsePackageManager(pkg?.packageManager);
    const locks = [...new Set(scope.lockfiles.map((file) => LOCKFILE_MANAGERS[path.basename(file)]).filter(Boolean))];
    const evidence = new Set<TargetPackageManager>(locks);
    if (declared) evidence.add(declared.manager);
    if (scope.denoConfig) evidence.add('deno');
    if (evidence.size > 1) {
      return { status: 'ambiguous', manager: null, source: scope.path };
    }
    const manager = declared?.manager ?? locks[0] ?? (scope.denoConfig ? 'deno' : null);
    if (manager) {
      return {
        status: 'resolved',
        manager,
        version: declared?.version ?? (manager === 'yarn' && scope.yarnBerry ? '2' : undefined),
        source: declared ? `${scope.path}/package.json#packageManager` : `${scope.path}/${scope.lockfiles[0] ?? 'deno.json'}`,
      };
    }
  }
  return { status: 'unavailable', manager: null, source: null };
}

function adapter(
  manager: Exclude<TargetPackageManager, 'deno'>,
  version?: string,
): PackageManagerAdapter {
  return {
    script(name: string, packagePath: string, repositoryRoot: string) {
      const scope = scopeArgument(manager, packagePath, repositoryRoot);
      if (manager === 'yarn') return `yarn${scope} run ${name}`;
      return `${manager}${scope} run ${name}`;
    },
    localTypecheck(packagePath: string, repositoryRoot: string) {
      const scope = scopeArgument(manager, packagePath, repositoryRoot);
      if (manager === 'bun') return `bun${scope} x --no-install tsc --noEmit`;
      if (manager === 'npm') return `npm${scope} exec --offline --no -- tsc --noEmit`;
      if (manager === 'pnpm') return `pnpm${scope} exec tsc --noEmit`;
      return yarnMajor(version) >= 2
        ? `yarn${scope} exec tsc --noEmit`
        : `yarn${scope} run tsc --noEmit`;
    },
  };
}

function scopeArgument(
  manager: Exclude<TargetPackageManager, 'deno'>,
  packagePath: string,
  repositoryRoot: string,
) {
  const relative = path.relative(repositoryRoot, packagePath);
  if (!relative) return '';
  const quoted = quoteArgument(relative);
  if (manager === 'npm') return ` --prefix ${quoted}`;
  if (manager === 'pnpm') return ` --dir ${quoted}`;
  return ` --cwd ${quoted}`;
}

function owningScopePaths(root: string, changedFiles: string[]) {
  const normalizedRoot = path.resolve(root);
  const directories = changedFiles.map((file) => {
    const absolute = path.resolve(normalizedRoot, file);
    return absolute.startsWith(`${normalizedRoot}${path.sep}`) ? path.dirname(absolute) : normalizedRoot;
  });
  const candidates = new Set<string>();
  for (const start of directories.length > 0 ? directories : [normalizedRoot]) {
    let current = start;
    while (current.startsWith(normalizedRoot)) {
      candidates.add(current);
      if (current === normalizedRoot) break;
      current = path.dirname(current);
    }
  }
  return [...candidates].sort((left, right) => depth(right) - depth(left));
}

async function loadScope(scopePath: string): Promise<RepositoryToolchainScope> {
  const lockfiles = await Promise.all(Object.keys(LOCKFILE_MANAGERS).map(async (file) =>
    await exists(path.join(scopePath, file)) ? file : null));
  const denoFile = await exists(path.join(scopePath, 'deno.json'))
    ? 'deno.json'
    : await exists(path.join(scopePath, 'deno.jsonc')) ? 'deno.jsonc' : null;
  const packageJson = await readMaybe(path.join(scopePath, 'package.json'));
  const yarnBerry = await exists(path.join(scopePath, '.yarnrc.yml'));
  const yarnInstallState = await exists(path.join(scopePath, '.pnp.cjs')) ||
    await exists(path.join(scopePath, '.yarn', 'install-state.gz'));
  return {
    path: scopePath,
    packageJson,
    lockfiles: lockfiles.filter((file): file is string => file !== null),
    denoConfig: denoFile ? await readMaybe(path.join(scopePath, denoFile)) : null,
    yarnBerry,
    localTypeScriptInstalled: await exists(path.join(scopePath, 'node_modules', '.bin', 'tsc')) ||
      (yarnBerry && yarnInstallState && declaresTypeScript(packageJson)),
  };
}

function readPackage(contents?: string | null) {
  if (!contents) return null;
  try {
    const parsed = JSON.parse(contents) as Record<string, unknown>;
    const scripts = parsed.scripts && typeof parsed.scripts === 'object'
      ? Object.fromEntries(Object.entries(parsed.scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {};
    return { ...parsed, scripts } as Record<string, unknown> & { scripts: Record<string, string>; packageManager?: string };
  } catch {
    return null;
  }
}

function parsePackageManager(value: unknown) {
  if (typeof value !== 'string') return null;
  const [name, version] = value.split('@');
  return ['bun', 'npm', 'pnpm', 'yarn'].includes(name)
    ? { manager: name as Exclude<TargetPackageManager, 'deno'>, version }
    : null;
}

function declaresTypeScript(contents?: string | null) {
  const pkg = readPackage(contents);
  if (!pkg) return false;
  return ['dependencies', 'devDependencies', 'peerDependencies'].some((key) => {
    const values = pkg[key];
    return Boolean(values && typeof values === 'object' && 'typescript' in values);
  });
}

function isLocalOnlyScript(script: string) {
  return !/(?:^|[;&|\s])(npx|bunx|curl|wget)(?:\s|$)/i.test(script) &&
    !/\b(?:npm|pnpm|yarn|bun)\s+(?:add|install|update|dlx)\b/i.test(script);
}

function resolvedProfile(
  packagePath: string,
  manager: TargetPackageManager,
  managerSource: string | null,
  command: string,
  source: RepositoryToolchainProfile['typecheck']['source'],
): RepositoryToolchainProfile {
  return {
    packagePath,
    manager,
    managerSource,
    status: 'resolved',
    typecheck: { command, source, guarantee: 'local_only_no_install' },
  };
}

function unavailable(
  packagePath: string,
  cause: ToolchainResolutionCause,
  manager: TargetPackageManager | null = null,
  managerSource: string | null = null,
): RepositoryToolchainProfile {
  return {
    packagePath,
    manager,
    managerSource,
    status: cause === 'TOOLCHAIN_AMBIGUOUS' ? 'ambiguous' : 'unavailable',
    cause,
    typecheck: { command: null, source: null, guarantee: null },
  };
}

function yarnMajor(version?: string) {
  const major = Number(version?.split('.')[0]);
  return Number.isFinite(major) ? major : 1;
}

function quoteArgument(value: string) {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function depth(value: string) {
  return value.split(path.sep).length;
}

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readMaybe(file: string) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

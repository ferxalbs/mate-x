import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ValidationRequirementId } from '../contracts/workspace';

export type TargetPackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn' | 'deno';
export type ToolchainResolutionCause = 'TOOLCHAIN_AMBIGUOUS' | 'TYPECHECK_UNAVAILABLE';

export interface RepositoryToolchainScope {
  path: string;
  packageJson?: string | null;
  lockfiles: string[];
  denoConfig?: string | null;
  yarnBerry?: boolean;
  localTypeScriptInstalled: boolean;
  nativeFiles?: string[];
  nativeTargets?: string[];
}

export interface RepositoryToolchainProfile {
  packagePath: string;
  manager: TargetPackageManager | null;
  managerSource: string | null;
  status: 'resolved' | 'ambiguous' | 'unavailable';
  cause?: ToolchainResolutionCause;
  commands: Record<Exclude<ValidationRequirementId, 'validation'>, RepositoryValidationCommand>;
  typecheck: {
    command: string | null;
    source: RepositoryValidationCommand['source'];
    guarantee: 'local_only_no_install' | null;
  };
}

export interface RepositoryValidationCommand {
  command: string | null;
  source: 'script' | 'local_toolchain' | 'deno' | 'native' | null;
  guarantee: 'local_only_no_install' | null;
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
  if (!manager) {
    const nativeCommands = resolveNativeValidationCommands(scopes);
    return nativeCommands
      ? nativeProfile(packageScope.path, nativeCommands.packagePath, nativeCommands.commands)
      : unavailable(packageScope.path, 'TYPECHECK_UNAVAILABLE');
  }

  const repositoryRoot = scopes.at(-1)?.path ?? packageScope.path;
  const commands = resolveValidationCommands(
    scopes,
    changedFiles,
    manager,
    managerResolution.version,
    repositoryRoot,
  );

  if (manager === 'deno') {
    const targets = changedFiles
      .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
      .map(quoteArgument);
    const typecheck = {
      command: `deno check ${targets.length > 0 ? targets.join(' ') : '.'}`,
      source: 'deno' as const,
      guarantee: 'local_only_no_install' as const,
    };
    return resolvedProfile(
      packageScope.path,
      manager,
      managerResolution.source,
      { ...commands, typecheck },
    );
  }

  const declaredScope = scopes.find((scope) => declaresTypeScript(scope.packageJson));
  const installedScope = scopes.find((scope) => scope.localTypeScriptInstalled);
  if (commands.typecheck.command) {
    return resolvedProfile(
      packagePathForCommand(scopes, commands.typecheck, packageScope.path),
      manager,
      managerResolution.source,
      commands,
    );
  }

  if (declaredScope && installedScope) {
    const typecheck = {
      command: adapter(manager, managerResolution.version).localTypecheck(declaredScope.path, repositoryRoot),
      source: 'local_toolchain' as const,
      guarantee: 'local_only_no_install' as const,
    };
    return resolvedProfile(
      declaredScope.path,
      manager,
      managerResolution.source,
      { ...commands, typecheck },
    );
  }

  return unavailable(
    packageScope.path,
    'TYPECHECK_UNAVAILABLE',
    manager,
    managerResolution.source,
    commands,
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
    const scriptEvidence = scriptManagerEvidence(pkg?.scripts ?? {});
    const evidence = new Set<TargetPackageManager>(locks);
    if (declared) evidence.add(declared.manager);
    if (scope.denoConfig) evidence.add('deno');
    for (const scriptManager of scriptEvidence) evidence.add(scriptManager);
    if (evidence.size > 1) {
      return { status: 'ambiguous', manager: null, source: scope.path };
    }
    const manager = declared?.manager ?? locks[0] ?? (scope.denoConfig ? 'deno' : null);
    const inferredScriptManager = scriptEvidence.values().next().value as TargetPackageManager | undefined;
    const resolvedManager = manager ?? inferredScriptManager ?? null;
    if (resolvedManager) {
      const source = declared
        ? `${scope.path}/package.json#packageManager`
        : locks[0]
          ? `${scope.path}/${scope.lockfiles[0]}`
          : `${scope.path}/package.json#scripts`;
      return {
        status: 'resolved',
        manager: resolvedManager,
        version: declared?.version ?? (resolvedManager === 'yarn' && scope.yarnBerry ? '2' : undefined),
        source,
      };
    }
  }
  return { status: 'unavailable', manager: null, source: null };
}

function adapter(
  manager: TargetPackageManager,
  version?: string,
): PackageManagerAdapter {
  return {
    script(name: string, packagePath: string, repositoryRoot: string) {
      if (manager === 'deno') return `deno task ${name}`;
      const scope = scopeArgument(manager, packagePath, repositoryRoot);
      if (manager === 'yarn') return `yarn${scope} run ${name}`;
      return `${manager}${scope} run ${name}`;
    },
    localTypecheck(packagePath: string, repositoryRoot: string) {
      if (manager === 'deno') return `deno check .`;
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
  const nativeFiles = await Promise.all([
    'Cargo.toml',
    'go.mod',
    'pytest.ini',
    'pyproject.toml',
    'Makefile',
    'Justfile',
  ].map(async (file) => await exists(path.join(scopePath, file)) ? file : null));
  const makefile = await readMaybe(path.join(scopePath, 'Makefile'));
  const justfile = await readMaybe(path.join(scopePath, 'Justfile'));
  return {
    path: scopePath,
    packageJson,
    lockfiles: lockfiles.filter((file): file is string => file !== null),
    denoConfig: denoFile ? await readMaybe(path.join(scopePath, denoFile)) : null,
    yarnBerry,
    localTypeScriptInstalled: await exists(path.join(scopePath, 'node_modules', '.bin', 'tsc')) ||
      (yarnBerry && yarnInstallState && declaresTypeScript(packageJson)),
    nativeFiles: nativeFiles.filter((file): file is string => file !== null),
    nativeTargets: [
      ...extractTargets(makefile),
      ...extractTargets(justfile),
    ],
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
  return !/(?:^|[;&|\s])(?:npx|bunx|curl|wget)(?:\s|$)/i.test(script) &&
    !/\b(?:npm|pnpm|yarn|bun)\s+(?:add|install|update|dlx|exec|x)\b/i.test(script) &&
    !/\b(?:npm|pnpm|yarn|bun)\s+run\s+(?:add|install|update|dlx)\b/i.test(script);
}

function scriptManagerEvidence(scripts: Record<string, string>) {
  const managers = new Set<TargetPackageManager>();
  for (const script of Object.values(scripts)) {
    if (!isLocalOnlyScript(script)) continue;
    const match = script.trim().match(/^(?:env\s+\S+=\S+\s+)?(bun|npm|pnpm|yarn|deno)\b/i);
    if (match) managers.add(match[1].toLowerCase() as TargetPackageManager);
  }
  return managers;
}

const VALIDATION_SCRIPT_NAMES = ['test', 'typecheck', 'lint', 'build'] as const;

function resolveValidationCommands(
  scopes: RepositoryToolchainScope[],
  changedFiles: string[],
  manager: TargetPackageManager,
  version: string | undefined,
  repositoryRoot: string,
) {
  const commands = Object.fromEntries(
    VALIDATION_SCRIPT_NAMES.map((name) => [name, unresolvedCommand()]),
  ) as Record<typeof VALIDATION_SCRIPT_NAMES[number], RepositoryValidationCommand>;

  for (const name of VALIDATION_SCRIPT_NAMES) {
    const scriptScope = scopes.find((scope) => Boolean(readPackage(scope.packageJson)?.scripts[name]));
    const script = scriptScope ? readPackage(scriptScope.packageJson)?.scripts[name] : undefined;
    if (!scriptScope || !script || !isLocalOnlyScript(script)) continue;
    commands[name] = {
      command: adapter(manager, version).script(name, scriptScope.path, repositoryRoot),
      source: 'script',
      guarantee: 'local_only_no_install',
    };
  }

  if (manager === 'deno') {
    const targets = changedFiles
      .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
      .map(quoteArgument);
    commands.typecheck = {
      command: `deno check ${targets.length > 0 ? targets.join(' ') : '.'}`,
      source: 'deno',
      guarantee: 'local_only_no_install',
    };
  }

  return commands;
}

function resolveNativeValidationCommands(scopes: RepositoryToolchainScope[]) {
  const scope = scopes.find((candidate) => (candidate.nativeFiles ?? []).length > 0);
  if (!scope) return undefined;
  const files = new Set(scope.nativeFiles);
  if (files.has('Cargo.toml')) {
    return {
      packagePath: scope.path,
      commands: {
        test: nativeCommand('cargo test'),
        typecheck: nativeCommand('cargo check'),
        lint: nativeCommand('cargo clippy'),
        build: nativeCommand('cargo build'),
      },
    };
  }
  if (files.has('go.mod')) {
    return {
      packagePath: scope.path,
      commands: {
        test: nativeCommand('go test ./...'),
        typecheck: unresolvedCommand(),
        lint: nativeCommand('go vet ./...'),
        build: nativeCommand('go build ./...'),
      },
    };
  }
  if (files.has('pytest.ini')) {
    return {
      packagePath: scope.path,
      commands: {
        test: nativeCommand('pytest'),
        typecheck: unresolvedCommand(),
        lint: unresolvedCommand(),
        build: unresolvedCommand(),
      },
    };
  }
  if (files.has('Makefile') || files.has('Justfile')) {
    const targets = new Set(scope.nativeTargets ?? []);
    const runner = files.has('Makefile') ? 'make' : 'just';
    const commandFor = (name: string) => targets.has(name)
      ? nativeCommand(`${runner} ${name}`)
      : unresolvedCommand();
    return {
      packagePath: scope.path,
      commands: {
        test: commandFor('test'),
        typecheck: commandFor('typecheck'),
        lint: commandFor('lint'),
        build: commandFor('build'),
      },
    };
  }
  return undefined;
}

function nativeCommand(command: string): RepositoryValidationCommand {
  return {
    command,
    source: 'native',
    guarantee: 'local_only_no_install',
  };
}

function extractTargets(contents: string | null) {
  return contents
    ? [...contents.matchAll(/^([A-Za-z0-9_.-]+)\s*:/gm)].map((match) => match[1])
    : [];
}

function unresolvedCommand(): RepositoryValidationCommand {
  return { command: null, source: null, guarantee: null };
}

function nativeProfile(
  packagePath: string,
  managerSource: string,
  commands: Record<Exclude<ValidationRequirementId, 'validation'>, RepositoryValidationCommand>,
): RepositoryToolchainProfile {
  return {
    packagePath,
    manager: null,
    managerSource: `${managerSource}/native-validation`,
    status: commands.typecheck.command ? 'resolved' : 'unavailable',
    cause: commands.typecheck.command ? undefined : 'TYPECHECK_UNAVAILABLE',
    commands,
    typecheck: commands.typecheck,
  };
}

function packagePathForCommand(
  scopes: RepositoryToolchainScope[],
  command: RepositoryValidationCommand,
  fallback: string,
) {
  if (command.source !== 'script') return fallback;
  const scriptScope = scopes.find((scope) => Boolean(readPackage(scope.packageJson)?.scripts.typecheck));
  return scriptScope?.path ?? fallback;
}

function resolvedProfile(
  packagePath: string,
  manager: TargetPackageManager,
  managerSource: string | null,
  commands: Record<Exclude<ValidationRequirementId, 'validation'>, RepositoryValidationCommand>,
): RepositoryToolchainProfile {
  return {
    packagePath,
    manager,
    managerSource,
    status: 'resolved',
    commands,
    typecheck: commands.typecheck,
  };
}

function unavailable(
  packagePath: string,
  cause: ToolchainResolutionCause,
  manager: TargetPackageManager | null = null,
  managerSource: string | null = null,
  commands: Record<Exclude<ValidationRequirementId, 'validation'>, RepositoryValidationCommand> = emptyCommands(),
): RepositoryToolchainProfile {
  return {
    packagePath,
    manager,
    managerSource,
    status: cause === 'TOOLCHAIN_AMBIGUOUS' ? 'ambiguous' : 'unavailable',
    cause,
    commands,
    typecheck: commands.typecheck,
  };
}

function emptyCommands() {
  return {
    test: unresolvedCommand(),
    typecheck: unresolvedCommand(),
    lint: unresolvedCommand(),
    build: unresolvedCommand(),
  } satisfies Record<Exclude<ValidationRequirementId, 'validation'>, RepositoryValidationCommand>;
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

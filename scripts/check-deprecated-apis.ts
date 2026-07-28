import path from 'node:path';
import ts from 'typescript';

export interface DeprecatedApiDiagnostic {
  filePath: string;
  line: number;
  column: number;
  symbolName: string;
  message: string;
}

function loadProgram(rootDirectory: string): ts.Program {
  const configPath = ts.findConfigFile(
    rootDirectory,
    ts.sys.fileExists,
    'tsconfig.json',
  );
  if (!configPath) {
    throw new Error(`No tsconfig.json found under ${rootDirectory}.`);
  }
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(configPath),
  );
  return ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
  });
}

function resolveSymbol(
  checker: ts.TypeChecker,
  node: ts.Identifier,
): ts.Symbol | undefined {
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return undefined;
  return symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function deprecatedTagForNode(
  checker: ts.TypeChecker,
  node: ts.Identifier,
  symbol: ts.Symbol,
): ts.JSDocTagInfo | undefined {
  const parent = node.parent;
  const call =
    ts.isCallExpression(parent) && parent.expression === node
      ? parent
      : ts.isPropertyAccessExpression(parent) &&
          parent.name === node &&
          ts.isCallExpression(parent.parent) &&
          parent.parent.expression === parent
        ? parent.parent
        : null;
  if (call) {
    return checker
      .getResolvedSignature(call)
      ?.getJsDocTags()
      .find((tag) => tag.name === 'deprecated');
  }
  return symbol
    .getJsDocTags(checker)
    .find((tag) => tag.name === 'deprecated');
}

export function scanForDeprecatedApis(
  rootDirectory = process.cwd(),
): DeprecatedApiDiagnostic[] {
  const root = path.resolve(rootDirectory);
  const program = loadProgram(root);
  const checker = program.getTypeChecker();
  const diagnostics: DeprecatedApiDiagnostic[] = [];
  const seen = new Set<string>();

  for (const sourceFile of program.getSourceFiles()) {
    const filePath = path.resolve(sourceFile.fileName);
    if (
      !filePath.startsWith(`${root}${path.sep}`) ||
      filePath.includes(`${path.sep}node_modules${path.sep}`) ||
      sourceFile.isDeclarationFile
    ) {
      continue;
    }

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const symbol = resolveSymbol(checker, node);
        const deprecatedTag = symbol
          ? deprecatedTagForNode(checker, node, symbol)
          : undefined;
        if (symbol && deprecatedTag) {
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          const key = `${filePath}:${node.getStart(sourceFile)}:${symbol.getName()}`;
          if (!seen.has(key)) {
            seen.add(key);
            diagnostics.push({
              filePath,
              line: position.line + 1,
              column: position.character + 1,
              symbolName: symbol.getName(),
              message:
                deprecatedTag.text?.map((part) => part.text).join('') ||
                'Deprecated API usage.',
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
  }

  return diagnostics;
}

if (import.meta.main) {
  const diagnostics = scanForDeprecatedApis();
  if (diagnostics.length > 0) {
    for (const diagnostic of diagnostics) {
      const relativePath = path.relative(process.cwd(), diagnostic.filePath);
      console.error(
        `${relativePath}:${diagnostic.line}:${diagnostic.column} ` +
          `${diagnostic.symbolName}: ${diagnostic.message}`,
      );
    }
    process.exitCode = 1;
  } else {
    console.log('No deprecated API usage found.');
  }
}

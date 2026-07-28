import assert from 'node:assert/strict';
import { describe, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { scanForDeprecatedApis } from '../scripts/check-deprecated-apis';

function scanCodeSnippet(code: string): { symbolName: string; message: string }[] {
  const tempDir = path.join(process.cwd(), 'tests', 'fixtures', `dep-test-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const tsconfigPath = path.join(tempDir, 'tsconfig.json');
  const filePath = path.join(tempDir, 'index.ts');

  fs.writeFileSync(
    tsconfigPath,
    JSON.stringify({
      compilerOptions: {
        target: 'ESNext',
        module: 'ESNext',
        moduleResolution: 'bundler',
        skipLibCheck: true,
      },
      include: ['index.ts'],
    })
  );

  fs.writeFileSync(filePath, code);

  try {
    const diagnostics = scanForDeprecatedApis(tempDir);
    return diagnostics.map((d) => ({
      symbolName: d.symbolName,
      message: d.message,
    }));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

describe('check-deprecated-apis gate', () => {
  test('rejects a directly deprecated symbol', () => {
    const code = `
      /** @deprecated Use newApi instead */
      export function legacyApi() {
        return 42;
      }

      legacyApi();
    `;

    const results = scanCodeSnippet(code);
    assert.ok(results.length > 0);
    assert.equal(results.some((r) => r.symbolName === 'legacyApi'), true);
  });

  test('accepts a current non-deprecated symbol', () => {
    const code = `
      export function currentApi() {
        return 42;
      }

      currentApi();
    `;

    const results = scanCodeSnippet(code);
    assert.equal(results.length, 0);
  });

  test('rejects a deprecated imported or re-exported compatibility alias', () => {
    const tempDir = path.join(process.cwd(), 'tests', 'fixtures', `alias-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const tsconfigPath = path.join(tempDir, 'tsconfig.json');
    const modPath = path.join(tempDir, 'module.ts');
    const indexPath = path.join(tempDir, 'index.ts');

    fs.writeFileSync(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'bundler',
          skipLibCheck: true,
        },
        include: ['*.ts'],
      })
    );

    fs.writeFileSync(
      modPath,
      `
        export type ModernType = string;

        /** @deprecated Use ModernType instead */
        export type LegacyTypeAlias = ModernType;
      `
    );

    fs.writeFileSync(
      indexPath,
      `
        import { LegacyTypeAlias } from './module';

        const val: LegacyTypeAlias = 'hello';
        console.log(val);
      `
    );

    try {
      const diagnostics = scanForDeprecatedApis(tempDir);
      assert.ok(diagnostics.length > 0);
      assert.equal(diagnostics.some((d) => d.symbolName === 'LegacyTypeAlias'), true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

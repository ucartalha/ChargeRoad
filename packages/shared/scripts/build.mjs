import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const tsc = require.resolve('typescript/bin/tsc');
mkdirSync(new URL('../dist/cjs/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/cjs/package.json', import.meta.url), '{"type":"commonjs"}\n');
try {
  for (const project of ['tsconfig.build.json', 'tsconfig.cjs.json']) {
    execFileSync(process.execPath, [tsc, '-p', project], { cwd: root, stdio: 'inherit' });
  }
  if (process.argv.includes('--test')) {
    execFileSync(process.execPath, ['--test', 'tests/contracts.test.mjs'], { cwd: root, stdio: 'inherit' });
  }
} catch (error) {
  process.exitCode = typeof error.status === 'number' ? error.status : 1;
}

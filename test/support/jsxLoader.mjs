// A minimal Node ESM loader hook that transforms .ts/.tsx source through esbuild before
// evaluation - only needed for `test/ui-integration.test.ts`, which is the one test file that
// must import a real .tsx React component (ArchitectureContext.tsx contains JSX in its Provider).
// Every other test file in this project runs under `--experimental-strip-types`, which erases
// TypeScript *type* syntax but does not understand JSX at all - this loader is the (locally
// scoped, dependency-free beyond esbuild, which the project's own Vite build already depends on)
// substitute for exactly that one gap. `node_modules` is left untouched so third-party packages
// load exactly as npm shipped them.
import esbuild from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function load(url, context, nextLoad) {
  if ((url.endsWith('.tsx') || url.endsWith('.ts')) && !url.includes('/node_modules/')) {
    const filePath = fileURLToPath(url);
    let source = await readFile(filePath, 'utf8');
    // Node has no Vite asset glob; inspector tests exercise controls, not SVG loading.
    if (url.endsWith('/icons/awsIconRegistry.ts')) source = source.replace(/import\.meta\.glob\([\s\S]*?\);/, '{};');
    const loader = url.endsWith('.tsx') ? 'tsx' : 'ts';
    const result = await esbuild.transform(source, {
      loader,
      format: 'esm',
      target: 'es2022',
      sourcefile: filePath
    });
    return { format: 'module', source: result.code, shortCircuit: true };
  }
  return nextLoad(url, context);
}

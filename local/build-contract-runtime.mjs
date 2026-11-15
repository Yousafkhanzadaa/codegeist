// Development-only regeneration of the portable validator. The emitted runtime
// itself uses only Node built-ins; CLI users do not install a bundler or TypeScript.
import { rolldown } from 'rolldown';
const bundle = await rolldown({
  input: new URL('./contract-runtime-entry.ts', import.meta.url).pathname,
  platform: 'node',
  external: ['node:crypto'],
});
await bundle.write({
  file: new URL('./input-contract.mjs', import.meta.url).pathname,
  format: 'esm',
  banner: '// Generated from src/domain/input-contract.ts. Regenerate: node local/build-contract-runtime.mjs',
});
await bundle.close();

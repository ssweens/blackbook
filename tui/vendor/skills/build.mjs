// Bundles the vendored skills CLI into dist/vendor/skills, mirroring the
// upstream package layout (dist/cli.mjs + bin/cli.mjs + package.json) so its
// own `../package.json` and `../bin/cli.mjs` lookups keep working.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'dist', 'vendor', 'skills');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'dist'), { recursive: true });

await build({
  entryPoints: [join(here, 'src', 'cli.ts')],
  outfile: join(out, 'dist', 'cli.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // CJS deps (simple-git, tar internals) call require(); give ESM a real one.
  banner: {
    js: "import { createRequire as __bbCreateRequire } from 'node:module'; const require = __bbCreateRequire(import.meta.url);",
  },
  logLevel: 'warning',
});

cpSync(join(here, 'bin'), join(out, 'bin'), { recursive: true });
for (const f of ['package.json', 'LICENSE', 'ThirdPartyNoticeText.txt']) cpSync(join(here, f), join(out, f));

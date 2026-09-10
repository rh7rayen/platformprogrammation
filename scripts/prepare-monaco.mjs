import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let packageRoot=path.dirname(require.resolve('monaco-editor'));
while(!existsSync(path.join(packageRoot,'package.json'))) {
  const parent=path.dirname(packageRoot);
  if(parent===packageRoot)throw new Error('Monaco package root not found');
  packageRoot=parent;
}
const destination = path.join(root, 'frontend', 'public', 'monaco');
const monacoPackage = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
const purifyFile = require.resolve('dompurify');
const purifyPackage = JSON.parse(await readFile(path.resolve(path.dirname(purifyFile), '..', 'package.json'), 'utf8'));
if (purifyPackage.version !== '3.4.15') throw new Error('Run npm ci: Monaco requires the reviewed DOMPurify 3.4.15.');

// Monaco ships its own DOMPurify source AND an already-built AMD bundle. A
// package override alone cannot patch either: rebuild from ESM and resolve the
// vendored import to the reviewed npm package. Never publish the AMD directory.
const fixedPurify = {
  name: 'reviewed-dompurify',
  setup(builder) {
    builder.onResolve({ filter: /dompurify\/dompurify\.js$/ }, () => ({ path: purifyFile }));
  },
};
const shared = {
  bundle: true, platform: 'browser', format: 'iife', target: 'es2022', minify: true,
  legalComments: 'external', metafile: true, loader: { '.ttf': 'file' },
  assetNames: 'assets/[name]-[hash]', plugins: [fixedPurify], logLevel: 'warning',
};
await mkdir(destination, { recursive: true });
const editor = await build({
  ...shared, entryPoints: [path.join(packageRoot, 'esm/vs/index.js')],
  outfile: path.join(destination, 'editor.js'), globalName: 'UniExamMonaco',
});
const inputs = Object.keys(editor.metafile.inputs).map(name => name.replaceAll('\\', '/'));
if (inputs.some(name => name.endsWith('/base/browser/dompurify/dompurify.js')) || !inputs.some(name => name.endsWith('/dompurify/dist/purify.cjs.js'))) {
  throw new Error('Monaco build did not replace its vendored DOMPurify; refuse to publish.');
}
await build({
  ...shared,
  entryPoints: Object.fromEntries([
    ['editor.worker', 'editor/editor.worker.js'],
    ['css.worker', 'languages/features/css/css.worker.js'],
    ['html.worker', 'languages/features/html/html.worker.js'],
    ['json.worker', 'languages/features/json/json.worker.js'],
    ['ts.worker', 'languages/features/typescript/ts.worker.js'],
  ].map(([name, source]) => [name, path.join(packageRoot, 'esm/vs', source)])),
  outdir: destination,
});
await cp(path.join(packageRoot, 'LICENSE'), path.join(destination, 'MONACO-LICENSE.txt'));
await cp(path.resolve(path.dirname(purifyFile), '..', 'LICENSE'), path.join(destination, 'DOMPURIFY-LICENSE.txt'));

// Resolve and check this exact generated workspace directory before deleting
// the old assets. No embedded database or user directory is ever touched.
const legacy = path.resolve(destination, 'vs');
if (path.relative(destination, legacy) !== 'vs' || !destination.startsWith(root + path.sep)) throw new Error('Unsafe generated asset path');
await rm(legacy, { recursive: true, force: true });
const hashes = {};
for (const name of await readdir(destination)) {
  if (!/\.(js|css)$/.test(name)) continue;
  const data = await readFile(path.join(destination, name));
  if (/DOMPurify[^\n]{0,80}3\.4\.8/.test(data.toString())) throw new Error('Vulnerable DOMPurify found in generated asset');
  hashes[name] = createHash('sha256').update(data).digest('hex');
}
await writeFile(path.join(destination, 'build-manifest.json'), JSON.stringify({
  monaco: monacoPackage.version, dompurify: purifyPackage.version,
  source: 'ESM rebuilt with reviewed DOMPurify; no AMD assets', hashes,
}, null, 2));

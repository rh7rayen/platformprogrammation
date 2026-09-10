// Bounded, local-only check of the assets actually shipped to the browser.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'frontend/public/monaco');
const manifest = JSON.parse(await readFile(path.join(assets, 'build-manifest.json'), 'utf8'));
assert.equal(manifest.dompurify, '3.4.15');
for (const [name, expected] of Object.entries(manifest.hashes)) {
  const data = await readFile(path.join(assets, name));
  assert.equal(createHash('sha256').update(data).digest('hex'), expected);
}
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><div id="editor" style="width:100vw;height:90vh"></div>'); return; }
  if (!/^\/monaco\/(?:assets\/)?[\w.-]+$/.test(pathname)) { response.writeHead(404).end(); return; }
  try {
    const data = await readFile(path.join(assets, pathname.slice('/monaco/'.length)));
    response.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.ttf') ? 'font/ttf' : 'application/javascript');
    response.end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  const workers = [];
  page.on('pageerror', error => errors.push(error.stack));
  page.on('worker', worker => workers.push(worker.url()));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.addStyleTag({ url: `${base}/monaco/editor.css` });
  await page.evaluate(() => {
    globalThis.MonacoEnvironment = { getWorker(_id, label) {
      const kind = ['typescript', 'javascript'].includes(label) ? 'ts' : ['html', 'css', 'json'].includes(label) ? label : 'editor';
      return new Worker(`/monaco/${kind}.worker.js`);
    } };
  });
  await page.addScriptTag({ url: `${base}/monaco/editor.js` });
  const languages = await page.evaluate(() => {
    const monaco = globalThis.UniExamMonaco;
    const model=monaco.editor.createModel('# Python\n','python',monaco.Uri.parse('file:///main.py'));
    globalThis.testEditor = monaco.editor.create(document.querySelector('#editor'), { model, ariaLabel: 'Code Python', automaticLayout: true, editContext: false });
    return monaco.languages.getLanguages().map(language => language.id);
  });
  for (const language of ['python', 'php', 'java', 'html', 'css', 'javascript', 'typescript', 'cpp', 'rust', 'go']) assert.ok(languages.includes(language), `Missing ${language}`);
  const input = page.getByRole('textbox', { name: 'Code Python', exact: true });
  // Monaco renders a visual layer over its textarea. A user clicks that layer;
  // keyboard input then goes through the editor's accessible textbox.
  await page.locator('.monaco-editor .view-lines').click({ position: { x: 45, y: 12 } });
  await input.press('Control+End');
  await input.pressSequentially('print(42)');
  assert.equal(await page.evaluate(() => globalThis.testEditor.getValue()), '# Python\nprint(42)');
  const diagnostics = await Promise.race([page.evaluate(async () => {
    const monaco = globalThis.UniExamMonaco;
    const model = monaco.editor.createModel('const answer = ;', 'javascript', monaco.Uri.parse('file:///main.js'));
    globalThis.testEditor.setModel(model);
    const makeWorker = await monaco.typescript.getJavaScriptWorker();
    const worker = await makeWorker(model.uri);
    return (await worker.getSyntacticDiagnostics(model.uri.toString())).length;
  }),new Promise((_resolve,reject)=>setTimeout(()=>reject(new Error('Language worker timeout')),15000).unref())]);
  assert.ok(diagnostics > 0, 'JavaScript language worker must report the syntax error');
  assert.ok(workers.some(url => url.endsWith('/ts.worker.js')));
  assert.deepEqual(errors, []);
  await page.evaluate(() => { const model = globalThis.testEditor.getModel(); globalThis.testEditor.dispose(); model.dispose(); });
  console.log(JSON.stringify({ verified: true, dompurify: manifest.dompurify, languageCount: languages.length, localWorkers: workers.length, syntaxDiagnostics: diagnostics }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

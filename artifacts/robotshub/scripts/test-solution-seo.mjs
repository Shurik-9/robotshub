// Run after `pnpm --filter @workspace/robotshub run build`.
// This checks static metadata shells, not SSR or prerendered page content.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'dist/public');
const read = file => readFileSync(path.join(root, file), 'utf8');
const config = JSON.parse(read('src/data/seo-pages.json'));
const items = JSON.parse(read('src/data/solutions.json')).items;
const ids = [...new Set(items.map(item => item.id))];
const generated = JSON.parse(read('dist/seo-rewrites.json'));
const toml = read('.replit-artifact/artifact.toml');
// These rewrite blocks deliberately support only exact routes and the final
// wildcard. Fail if the config changes shape instead of silently skipping it.
const rules = [...toml.matchAll(/\[\[services\.production\.rewrites\]\]\s+from = ("[^"\n]+")\s+to = ("[^"\n]+")/g)]
  .map(([, from, to]) => ({ from: JSON.parse(from), to: JSON.parse(to) }));
assert.equal(rules.length, (toml.match(/\[\[services\.production\.rewrites\]\]/g) ?? []).length);

// Execute the actual client metadata resolver without loading React/browser
// dependencies. Cases are unrelated to this solution-only parity check.
const clientSource = read('src/lib/page-seo.ts').replace(/^import .*;\r?\n/gm, '');
const clientJs = ts.transpileModule(clientSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { pageMetadata } = await import(`data:text/javascript;base64,${Buffer.from(
  `const config=${JSON.stringify(config)};const solutionsData=${JSON.stringify({ items })};const CASES=[];\n${clientJs}`,
).toString('base64')}`);

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function checkHead(html, metadata) {
  const head = html.split('</head>')[0];
  const canonical = new URL(metadata.path, config.siteUrl).href;
  assert.equal((head.match(/<title>/g) ?? []).length, 1);
  assert.ok(head.includes(`<title>${escape(metadata.title)}</title>`));
  assert.equal((head.match(/<link rel="canonical"/g) ?? []).length, 1);
  assert.ok(head.includes(`<link rel="canonical" href="${escape(canonical)}" />`));
  for (const [attribute, key, value] of [
    ['name', 'description', metadata.description],
    ['name', 'robots', 'index, follow'],
    ['property', 'og:title', metadata.title],
    ['property', 'og:description', metadata.description],
    ['property', 'og:url', canonical],
    ['property', 'og:type', 'website'],
    ['property', 'og:image', new URL(config.image, config.siteUrl).href],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', metadata.title],
    ['name', 'twitter:description', metadata.description],
    ['name', 'twitter:image', new URL(config.image, config.siteUrl).href],
  ]) {
    assert.equal((head.match(new RegExp(`<meta ${attribute}="${key}"`, 'g')) ?? []).length, 1, key);
    assert.ok(head.includes(`<meta ${attribute}="${key}" content="${escape(value)}" />`), `${key}: ${metadata.path}`);
  }
}

test('every unique solution has one shell, matching the first catalog entry and client metadata', () => {
  assert.equal(new Set(generated.map(rule => rule.from)).size, generated.length);
  const solutionRules = generated.filter(rule => /^\/solutions\/[^/]+\/?$/.test(rule.from));
  assert.equal(solutionRules.length, ids.length * 2);
  assert.equal(new Set(solutionRules.map(rule => rule.to)).size, ids.length);
  for (const id of ids) {
    const url = `/solutions/${encodeURIComponent(id)}`;
    const rule = solutionRules.find(rule => rule.from === url);
    assert.ok(rule, url);
    const html = readFileSync(path.join(output, rule.to), 'utf8');
    checkHead(html, pageMetadata(url));
    assert.ok(html.includes('<div id="root"></div>'), 'shell keeps the SPA mount point');
    for (const [, asset] of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
      assert.ok(existsSync(path.join(output, asset)), asset);
    }
  }
  assert.ok(items.length > ids.length, 'fixture includes repeated product IDs');
});

test('sitemap contains each canonical solution URL exactly once, without slash/query variants', () => {
  const urls = [...read('dist/public/sitemap-pages.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.equal(urls.length, new Set(urls).size);
  const solutionUrls = urls.filter(url => new URL(url).pathname.startsWith('/solutions/'));
  assert.equal(solutionUrls.length, ids.length);
  assert.deepEqual(new Set(solutionUrls), new Set(ids.map(id =>
    new URL(`/solutions/${encodeURIComponent(id)}`, config.siteUrl).href)));
});

test('all exact production routes precede the fallback and preserve existing routes', () => {
  assert.deepEqual(rules.at(-1), { from: '/*', to: '/index.html' });
  assert.equal(new Set(rules.map(rule => rule.from)).size, rules.length);
  for (const expected of generated) {
    assert.deepEqual(rules.find(rule => rule.from === expected.from), expected);
  }
  assert.equal(rules.find(rule => rule.from === '/glossary').to, '/glossary/index.html');
});

test('direct HTTP requests use production rewrite targets, including trailing slashes and queries', async () => {
  // Local static-host harness uses the real artifact rules in order; it does
  // not claim to exercise the remote production host.
  const server = createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const rule = rules.find(rule => rule.from === pathname || rule.from === '/*');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(readFileSync(path.join(output, rule.to)));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // Cover desc_real, hero fallback, and a repeated ID with different data.
    const samples = [
      items.find(item => item.desc_real),
      items.find(item => !item.desc_real && item.hero),
      items.find((item, i) => items.findIndex(other => other.id === item.id) !== i),
    ];
    for (const item of samples) {
      assert.ok(item);
      const url = `/solutions/${encodeURIComponent(item.id)}`;
      for (const suffix of ['', '/', '?utm_source=seo-test', '/?utm_source=seo-test']) {
        const response = await fetch(`${base}${url}${suffix}`);
        assert.equal(response.status, 200);
        checkHead(await response.text(), pageMetadata(url));
      }
    }
    assert.equal(await (await fetch(`${base}/solutions/unknown-solution`)).text(), read('dist/public/index.html'));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

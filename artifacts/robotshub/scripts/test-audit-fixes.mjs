import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const rewrites = JSON.parse(readFileSync(path.join(root, 'dist/seo-rewrites.json'), 'utf8'));
const artifact = readFileSync(path.join(root, '.replit-artifact/artifact.toml'), 'utf8');
const config = JSON.parse(readFileSync(path.join(root, 'src/data/seo-pages.json'), 'utf8'));

test('every generated SEO shell has one correct canonical and route-specific metadata', () => {
  const titles = new Set();
  const uniqueRoutes = rewrites.filter(rule => rule.from === '/' || !rule.from.endsWith('/'));
  assert.equal(new Set(uniqueRoutes.map(route => route.from)).size, uniqueRoutes.length, 'SEO routes must be unique');
  assert.ok(uniqueRoutes.some(route => route.from === '/kak-eto-rabotaet'));
  for (const route of uniqueRoutes) {
    const html = readFileSync(path.join(root, 'dist/public', route.to), 'utf8');
    assert.equal((html.match(/rel="canonical"/g) ?? []).length, 1, route.from);
    assert.ok(html.includes(`href="${new URL(route.from, config.siteUrl).href}"`), route.from);
    assert.ok(html.includes(`property="og:url" content="${new URL(route.from, config.siteUrl).href}"`), route.from);
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    assert.ok(title, route.from);
    assert.ok(!titles.has(title), `Duplicate title: ${title}`);
    titles.add(title);
    assert.ok(html.includes('property="og:image" content="https://robotshub.ru/brand/logo.jpg"'));
    assert.ok(html.includes('id="root"'));
    assert.ok(html.includes('type="module"'));
    if (route.from.startsWith('/cases/')) assert.ok(html.includes('"@type":"Article"'), route.from);
  }
});

test('production rewrites reach every generated shell before the SPA fallback', () => {
  const production = artifact.slice(artifact.indexOf('[[services.production.rewrites]]'));
  const fallback = production.indexOf('from = "/*"');
  assert.ok(fallback > 0);
  for (const route of rewrites) {
    const expected = `from = "${route.from}"\nto = "${route.to}"`;
    const position = production.indexOf(expected);
    assert.ok(position >= 0 && position < fallback, `Missing or shadowed rewrite: ${route.from}`);
  }
  assert.ok(production.includes('from = "/glossary"\nto = "/glossary/index.html"'));
});

test('sitemap includes public catalogue, cases, glossary and news, but not the temporarily hidden vendor entry', () => {
  const built = readFileSync(path.join(root, 'dist/public/sitemap.xml'), 'utf8');
  const source = readFileSync(path.join(root, 'public/sitemap.xml'), 'utf8');
  const urls = text => new Set([...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]));
  assert.deepEqual(urls(source), urls(built));
  assert.equal([...urls(built)].filter(url => url.includes('/cases/')).length, 45);
  assert.ok(!built.includes('https://robotshub.ru/vendors'));
  const solutions = JSON.parse(readFileSync(path.join(root, 'src/data/solutions.json'), 'utf8')).items;
  for (const solution of solutions) assert.ok(urls(built).has(`https://robotshub.ru/solutions/${encodeURIComponent(solution.id)}`), solution.id);
  assert.ok(built.includes('https://robotshub.ru/glossary/'));
  assert.ok(built.includes('https://robotshub.ru/news'));
  assert.ok(built.includes('https://robotshub.ru/map'));
  assert.ok(built.includes('https://robotshub.ru/start'));
  assert.ok(built.includes('https://robotshub.ru/kak-eto-rabotaet'));
  assert.ok(!built.includes('<lastmod>'));
});

function intentHelpers(items) {
  const source = readFileSync(path.join(root, 'src/lib/calculation-intent.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, URLSearchParams,
    require(specifier) {
      assert.equal(specifier, '@/data/solutions.json');
      return { items };
    },
  });
  return exports;
}

test('calculation intent retains direction filters and rejects unknown model ids', () => {
  const helpers = intentHelpers([{ id: 'model-1', name: 'Модель 1' }]);
  const link = helpers.withCalculationIntent('/quick-select?sector=logistics', 'model-1');
  const query = new URL(link, config.siteUrl).searchParams;
  assert.equal(query.get('sector'), 'logistics');
  assert.equal(query.get('solution'), 'model-1');
  assert.equal(helpers.requestedCalculationSolution('?solution=model-1')?.id, 'model-1');
  assert.equal(helpers.requestedCalculationSolution('?solution=unknown'), null);
});

test('case CTAs use only unambiguous exact product names, including ё/е variants', () => {
  const helpers = intentHelpers([
    { id: 'same', name: 'Ronavi H1500 (грузоподъемность до 1 500 кг)' },
    { id: 'same', name: 'Ronavi H1500 (грузоподъемность до 1 500 кг)' },
  ]);
  assert.equal(helpers.findCaseCatalogSolution('Ronavi H1500 (грузоподъёмность до 1 500 кг)')?.id, 'same');
  assert.equal(helpers.findCaseCatalogSolution('другая модель'), null);
  const ambiguous = intentHelpers([{ id: 'a', name: 'Модель' }, { id: 'b', name: 'Модель' }]);
  assert.equal(ambiguous.findCaseCatalogSolution('Модель'), null);
});

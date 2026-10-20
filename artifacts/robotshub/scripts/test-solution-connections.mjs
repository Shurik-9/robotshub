import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const catalog = JSON.parse(await read('src/data/solutions.json'));
const dataImport = `const solutionsData = ${JSON.stringify(catalog)};`;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString('base64')}`;
const intentUrl = moduleUrl((await read('src/lib/calculation-intent.ts'))
  .replace("import solutionsData from '@/data/solutions.json';", dataImport));
const connections = await import(moduleUrl((await read('src/lib/solution-connections.ts'))
  .replace("import solutionsData from '@/data/solutions.json';", dataImport)
  .replace("'@/lib/calculation-intent'", JSON.stringify(intentUrl))));

// Parse the actual case data without evaluating its React page or old comments.
const source = ts.createSourceFile('cases.tsx', await read('src/pages/cases.tsx'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = source.statements.filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations])
  .find(item => ts.isIdentifier(item.name) && item.name.text === 'CASES');
assert.ok(declaration && ts.isArrayLiteralExpression(declaration.initializer));
const { cases } = await import(moduleUrl(`export const cases = ${declaration.initializer.getText(source)};`));
const models = [...new Map(catalog.items.map(item => [item.id,
  catalog.items.find(first => first.id === item.id)])).values()];

test('source links are explicit HTTP(S), deduplicated and never guessed', () => {
  assert.equal(connections.getSolutionSourceLinks({}).length, 0);
  for (const url of ['javascript:alert(1)', 'data:text/html,bad', 'https://user:password@example.com/', 'bad url']) {
    assert.deepEqual(connections.getSolutionSourceLinks({ specs: { source_url: url } }), []);
  }
  const links = connections.getSolutionSourceLinks({
    specs: { source_url: 'https://example.com/model' },
    specs_real: { source_url: 'https://example.com/model' },
  });
  assert.equal(links.length, 1);
  assert.equal(links[0].url, 'https://example.com/model');
});

test('cases connect both ways to the exact unambiguous catalog model', async () => {
  const { findCaseCatalogSolution } = await import(intentUrl);
  let linked = 0;
  for (const model of models) {
    for (const item of connections.getSolutionCases(model.id, cases)) {
      assert.equal(findCaseCatalogSolution(item.solutionName)?.id, model.id);
      assert.ok(cases.some(original => original.id === item.id));
      linked++;
    }
  }
  assert.ok(linked > 0);
  assert.deepEqual(connections.getSolutionCases(models[0].id, [{ solutionName: 'Ronavi' }]), []);
  console.log(`${models.length} model pages, ${linked}/${cases.length} cases linked by exact model identity; ${models.filter(model => connections.getSolutionSourceLinks(model).length).length} models have recorded source URLs.`);
});

test('related models never cross scenario, kind or subtype and never repeat IDs', () => {
  const normalize = value => value.trim().toLowerCase().replaceAll('ё', 'е');
  for (const model of models) {
    const related = connections.getRelatedSolutions(model.id, 3);
    assert.ok(related.length <= 3);
    assert.equal(new Set(related.map(item => item.id)).size, related.length);
    for (const item of related) {
      assert.notEqual(item.id, model.id);
      assert.equal(item.kind, model.kind);
      assert.equal(normalize(item.scenario), normalize(model.scenario));
      assert.equal(normalize(item.subtype), normalize(model.subtype));
    }
  }
  assert.deepEqual(connections.getRelatedSolutions('missing-id'), []);
  assert.deepEqual(connections.getRelatedSolutions(models[0].id, 0), []);
});

test('public standalone pages contain restored name, tagline and shared brand styling', async () => {
  const paths = [
    'public/glossary/index.html',
    '../api-server/src/news-engine/public/news.html',
    '../api-server/src/news-engine/public/lead.html',
    '../api-server/src/news-engine/public/cabinet.html',
    '../api-server/src/news-engine/public/admin-news.html',
    '../api-server/src/news-engine/server/news-seo.js',
  ];
  for (const path of paths) {
    const content = await read(path);
    assert.ok(content.includes('Железный аргумент'), path);
    assert.ok(content.includes('Центр подбора роботизации'), path);
    assert.ok(content.includes('href="/brand/brand.css"'), path);
    assert.ok(!content.includes('<b>ROBOTS</b>'), path);
    assert.ok(!/\bRobotsHub\b|\bRobotshub\b/.test(content), path);
  }
});

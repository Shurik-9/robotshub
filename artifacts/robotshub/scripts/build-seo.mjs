import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'dist/public');
const config = JSON.parse(readFileSync(path.join(root, 'src/data/seo-pages.json'), 'utf8'));
const solutions = JSON.parse(readFileSync(path.join(root, 'src/data/solutions.json'), 'utf8')).items;
if (solutions.some(item => typeof item.id !== 'string' || !item.id)) {
  throw new Error('Cannot generate sitemap: solution URLs require non-empty IDs.');
}
const sourcePath = path.join(root, 'src/pages/cases.tsx');
const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = source.statements
  .filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations])
  .find(item => ts.isIdentifier(item.name) && item.name.text === 'CASES');
if (!declaration || !ts.isArrayLiteralExpression(declaration.initializer)) {
  throw new Error('Cannot generate case SEO: exported CASES must be an array literal.');
}
const cases = declaration.initializer.elements.map(element => {
  if (!ts.isObjectLiteralExpression(element)) throw new Error('Cannot generate SEO for a non-literal case.');
  const values = Object.fromEntries(element.properties.filter(ts.isPropertyAssignment).map(property => {
    const name = property.name.getText(source).replace(/^['"]|['"]$/g, '');
    const value = property.initializer;
    return [name, ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) ? value.text : null];
  }));
  if (!values.id || !values.title || !values.lead) throw new Error('Case SEO requires literal id, title and lead.');
  return values;
});
if (new Set(cases.map(item => item.id)).size !== cases.length) throw new Error('Duplicate case URLs.');

function shorten(value, limit) {
  if (value.length <= limit) return value;
  const prefix = value.slice(0, limit - 1);
  const boundary = prefix.lastIndexOf(' ');
  return `${boundary > limit / 2 ? prefix.slice(0, boundary) : prefix}…`;
}
// Match SolutionDetail and pageMetadata: repeated catalog entries share an ID,
// and Array.find selects the first entry, not the last one.
const uniqueSolutions = solutions.filter((item, index) =>
  solutions.findIndex(candidate => candidate.id === item.id) === index);
const pages = [
  ...config.pages,
  ...cases.map(item => ({
    path: `/cases/${item.id}`,
    title: `${shorten(item.title, 46)} | Железный аргумент`,
    description: shorten(item.lead, 160),
    headline: item.title,
    indexable: true,
    type: 'article',
  })),
  ...uniqueSolutions.map(item => ({
    path: `/solutions/${encodeURIComponent(item.id)}`,
    title: `${shorten(item.name, 46)} | Железный аргумент`,
    description: shorten(item.desc_real || item.hero || `Характеристики, источники данных и запрос предложения по модели ${item.name}.`, 160),
    indexable: true,
  })),
];
if (new Set(pages.map(page => page.path)).size !== pages.length) {
  throw new Error('Cannot generate SEO: duplicate page URLs.');
}
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const template = readFileSync(path.join(output, 'index.html'), 'utf8');
function render(page) {
  let html = template.replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(page.title)}</title>`);
  const setMeta = (attribute, key, value) => {
    const tag = `<meta ${attribute}="${key}" content="${escape(value)}" />`;
    const pattern = new RegExp(`<meta\\s+${attribute}="${key}"[^>]*>`);
    html = pattern.test(html) ? html.replace(pattern, tag) : html.replace('</head>', `    ${tag}\n  </head>`);
  };
  const canonical = new URL(page.path, config.siteUrl).href;
  const image = new URL(config.image, config.siteUrl).href;
  setMeta('name', 'description', page.description);
  setMeta('name', 'robots', page.indexable ? 'index, follow' : 'noindex, follow');
  for (const [key, value] of Object.entries({
    'og:title': page.title, 'og:description': page.description, 'og:url': canonical,
    'og:type': page.type ?? 'website', 'og:image': image,
  })) setMeta('property', key, value);
  for (const [key, value] of Object.entries({
    'twitter:card': 'summary_large_image',
    'twitter:title': page.title, 'twitter:description': page.description, 'twitter:image': image,
  })) setMeta('name', key, value);
  html = html.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${escape(canonical)}" />`);
  if (page.type === 'article') {
    const json = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Article', headline: page.headline,
      description: page.description, mainEntityOfPage: canonical,
      publisher: { '@type': 'Organization', name: 'Железный аргумент', url: config.siteUrl },
    }).replaceAll('<', '\\u003c');
    html = html.replace('</head>', `    <script type="application/ld+json">${json}</script>\n  </head>`);
  }
  return html;
}
mkdirSync(path.join(output, '_seo'), { recursive: true });
const rewrites = [];
for (const page of pages) {
  const filename = page.path === '/' ? 'home.html' : `${page.path.slice(1).replaceAll('/', '--')}.html`;
  const to = `/_seo/${filename}`;
  writeFileSync(path.join(output, to), render(page));
  rewrites.push({ from: page.path, to });
  if (page.path !== '/') rewrites.push({ from: `${page.path}/`, to });
}
// Keep the general SPA fallback for unknown URLs. The client applies
// noindex to its visible 404; an actual HTTP 404 needs hosting/server support.
const sitemapPaths = [...new Set([
  ...pages.filter(page => page.indexable && page.sitemap !== false).map(page => page.path),
  '/glossary/', '/news',
])];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapPaths.map(url => `  <url><loc>${escape(new URL(url, config.siteUrl).href)}</loc></url>`).join('\n')}\n</urlset>\n`;
// A sitemap index links the static site and the live news database. Never
// snapshot news during a frontend build or mix <url> with <sitemap> entries.
const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['/sitemap-pages.xml', '/news/sitemap.xml'].map(url => `  <sitemap><loc>${escape(new URL(url, config.siteUrl).href)}</loc></sitemap>`).join('\n')}\n</sitemapindex>\n`;
for (const directory of [output, path.join(root, 'public')]) {
  writeFileSync(path.join(directory, 'sitemap-pages.xml'), sitemap);
  writeFileSync(path.join(directory, 'sitemap.xml'), sitemapIndex);
}
writeFileSync(path.join(root, 'dist/seo-rewrites.json'), JSON.stringify(rewrites, null, 2));
console.log(`SEO: ${pages.length} HTML shells, ${uniqueSolutions.length} solutions, ${cases.length} case articles, ${sitemapPaths.length} sitemap URLs.`);

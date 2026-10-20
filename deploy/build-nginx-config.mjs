import { readFileSync, writeFileSync } from 'node:fs';

// Use the same generated routes as the hosted build, before the SPA fallback.
const routes = JSON.parse(readFileSync('artifacts/robotshub/dist/seo-rewrites.json', 'utf8'));
const locations = routes.map(({ from, to }) => {
  if (!/^\/[a-zA-Z0-9/_-]*$/.test(from) || !/^\/_seo\/[a-zA-Z0-9_-]+\.html$/.test(to)) {
    throw new Error(`Unsafe SEO route: ${from}`);
  }
  return `    location = ${from} {\n        try_files ${to} =404;\n        add_header Cache-Control "no-cache";\n    }`;
}).join('\n\n');
const template = readFileSync('deploy/nginx.conf', 'utf8');
if (!template.includes('    # SEO_ROUTE_LOCATIONS')) throw new Error('Missing SEO locations marker');
writeFileSync('deploy/nginx.generated.conf', template.replace('    # SEO_ROUTE_LOCATIONS', locations));

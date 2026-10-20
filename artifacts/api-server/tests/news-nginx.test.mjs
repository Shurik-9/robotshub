import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const locations = xml => [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, 'exit');
  child.kill('SIGTERM');
  await done;
}

test('production nginx paths reach standalone news with persistent data and no PostgreSQL', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'news-nginx-'));
  const site = path.join(dir, 'site');
  mkdirSync(site);
  for (const name of ['sitemap.xml', 'sitemap-pages.xml']) {
    copyFileSync(path.join(repo, 'artifacts/robotshub/public', name), path.join(site, name));
  }
  // Distinguish the SPA fallback from a genuine XML/document response.
  writeFileSync(path.join(site, 'index.html'), '<!doctype html><title>SPA fallback fixture</title>');
  const newsPort = await freePort();
  const webPort = await freePort();
  const base = `http://127.0.0.1:${webPort}`;
  const env = {
    ...process.env, NEWS_DATA_DIR: path.join(dir, 'db'), PORT: String(newsPort),
    ADMIN_TOKEN: 'proxy-test-only', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', DATABASE_URL: '',
  };
  let diagnostics = '';
  const run = (cmd, args, options) => {
    const child = spawn(cmd, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { diagnostics += data; });
    child.stderr.on('data', data => { diagnostics += data; });
    child.on('error', error => { diagnostics += error.message; });
    return child;
  };
  const waitReady = async url => {
    for (let n = 0; n < 100; n++) {
      try { if ((await fetch(url)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`Service failed to start: ${diagnostics}`);
  };
  const startNews = () => run(process.execPath, [
    path.join(repo, 'artifacts/api-server/src/news-engine/server/news-server.js'),
  ], { env });
  let news;
  let nginx;
  let db;
  try {
    news = startNews();
    await waitReady(`http://127.0.0.1:${newsPort}/healthz`);
    const productionConfig = readFileSync(path.join(repo, 'deploy/nginx.conf'), 'utf8')
      .replace('listen 8080;', `listen 127.0.0.1:${webPort};`)
      .replace('/usr/share/nginx/html', site)
      .replace('http://news:8099', `http://127.0.0.1:${newsPort}`);
    const config = path.join(dir, 'nginx.conf');
    writeFileSync(config, `daemon off;\npid ${dir}/nginx.pid;\nerror_log stderr;\nevents {}\nhttp {\naccess_log off;\nclient_body_temp_path ${dir}/client;\nproxy_temp_path ${dir}/proxy;\n${productionConfig}\n}\n`);
    nginx = run('nginx', ['-p', `${dir}/`, '-c', config]);
    await waitReady(`${base}/healthz`);
    const maps = locations(await (await fetch(`${base}/sitemap.xml`)).text());
    assert.deepEqual(maps, ['https://robotshub.ru/sitemap-pages.xml', 'https://robotshub.ru/news/sitemap.xml']);
    for (const url of maps) {
      const response = await fetch(base + new URL(url).pathname);
      const xml = await response.text();
      assert.equal(response.status, 200);
      assert.match(xml, /<urlset /);
      assert.doesNotMatch(xml, /SPA fallback/);
    }
    assert.equal((await fetch(`${base}/news`)).status, 200);
    // Add data only after startup migration, and only in this disposable DB.
    const { default: Database } = await import('better-sqlite3');
    db = new Database(path.join(env.NEWS_DATA_DIR, 'news.db'));
    const id = Number(db.prepare("INSERT INTO items(title,summary,url,status) VALUES('Proxy article','Summary','https://example.org/original','published')").run().lastInsertRowid);
    const getMap = async () => locations(await (await fetch(`${base}/news/sitemap.xml`)).text());
    assert.deepEqual(await getMap(), [`https://robotshub.ru/news/${id}`]);
    const article = await fetch(`${base}/news/${id}`);
    assert.equal(article.status, 200);
    assert.match(await article.text(), new RegExp(`rel="canonical" href="https://robotshub.ru/news/${id}"`));
    await stop(news);
    news = startNews();
    await waitReady(`http://127.0.0.1:${newsPort}/healthz`);
    assert.deepEqual(await getMap(), [`https://robotshub.ru/news/${id}`], 'restart must retain publication');
    const mutate = (suffix, body, method = 'POST') => fetch(`${base}/api/news/items/${id}${suffix}`, {
      method, headers: { 'Content-Type': 'application/json', 'x-admin-token': 'proxy-test-only' },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal((await mutate('/status', { status: 'hidden' })).status, 200);
    assert.deepEqual(await getMap(), []);
    assert.equal((await fetch(`${base}/news/${id}`)).status, 404);
    assert.equal((await mutate('/status', { status: 'published' })).status, 200);
    assert.deepEqual(await getMap(), [`https://robotshub.ru/news/${id}`]);
    assert.equal((await mutate('', null, 'DELETE')).status, 200);
    assert.deepEqual(await getMap(), []);
    assert.equal((await fetch(`${base}/news/${id}`)).status, 404);
  } finally {
    await stop(nginx);
    await stop(news);
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

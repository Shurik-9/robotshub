// Автономный запуск движка новостей (если приложение ещё не имеет своего Express-сервера):
//   ADMIN_TOKEN=<секрет> node server/news-server.js
// Если сервер в проекте уже есть — не запускайте этот файл, а смонтируйте createNewsRouter().
import express from 'express';
import { CFG } from './config.js';
import { createNewsRouter } from './router.js';
import { db } from './db.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.get('/healthz', (_req, res) => {
  db.prepare('SELECT 1').get();
  res.json({ status: 'ok' });
});
app.use(createNewsRouter());

app.get('/', (_req, res) => res.redirect('/news'));

app.use((_req, res) => res.status(404).send('Not found'));

app.listen(CFG.port, '0.0.0.0', () => {
  console.log(`news-engine: http://0.0.0.0:${CFG.port} (страница /news, админка /admin-news)`);
  if (!CFG.adminToken) console.warn('ВНИМАНИЕ: ADMIN_TOKEN не задан — админ-API вернёт 503. Задайте его в env/Secrets.');
});

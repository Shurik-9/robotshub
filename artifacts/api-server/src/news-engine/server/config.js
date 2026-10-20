import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CFG = {
  // Verified primary production domain; never derive canonicals from request Host.
  siteUrl: 'https://robotshub.ru',
  root: path.join(__dirname, '..'),
  publicDir: path.join(__dirname, '..', 'public'),
  dataDir: process.env.NEWS_DATA_DIR || path.join(__dirname, '..', '.data'),
  dbFile: path.join(process.env.NEWS_DATA_DIR || path.join(__dirname, '..', '.data'), 'news.db'),
  adminToken: process.env.ADMIN_TOKEN || '',
  port: Number(process.env.PORT || 8099),
  ua: 'RobotshubNewsBot/1.0 (+https://robotshub.ru; hello@robotshub.ru)',
  feedTimeoutMs: 15000,
  maxSummaryChars: 420,
};

export function requireToken(req, res, next) {
  if (!CFG.adminToken) {
    return res.status(503).json({ error: 'ADMIN_TOKEN не задан (env). Установите его в Secrets и перезапустите.' });
  }
  if ((req.headers['x-admin-token'] || '') !== CFG.adminToken) {
    return res.status(401).json({ error: 'Неверный токен' });
  }
  next();
}

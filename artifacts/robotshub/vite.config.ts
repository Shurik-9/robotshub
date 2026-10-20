import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const port = Number(process.env.PORT ?? 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer from 1 to 65535');
}

const basePath = process.env.BASE_PATH ?? '/';
if (!basePath.startsWith('/') || !basePath.endsWith('/')) {
  throw new Error('BASE_PATH must begin and end with /');
}

function rewriteGlossaryPath(req: { url?: string }, _res: unknown, next: () => void) {
  const [pathname, query] = (req.url ?? '').split('?', 2);
  if (pathname === '/glossary' || pathname === '/glossary/') {
    req.url = `/glossary/index.html${query ? `?${query}` : ''}`;
  }
  next();
}

export default defineConfig({
  base: basePath,
  plugins: [
    {
      name: 'robotshub-glossary-static-route',
      configureServer(server) {
        server.middlewares.use(rewriteGlossaryPath);
      },
      configurePreviewServer(server) {
        server.middlewares.use(rewriteGlossaryPath);
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});

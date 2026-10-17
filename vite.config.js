import { defineConfig } from 'vite';

/** Фиксируем порт: два параллельных dev-сервера не должны работать незаметно. */
export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true }
});

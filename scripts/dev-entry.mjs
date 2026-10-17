import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Единая команда `npm run dev`:
 *   - обычно запускает монитор ZIP + Vite;
 *   - если её вызвал СТАРЫЙ (<0.1.10004) монитор при самообновлении,
 *     активный watcher.lock означает, что нужен только сервер Vite.
 * Это совместимо со старыми процессами, уже запущенными в VS Code.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = path.join(ROOT, '.verdant-update', 'watcher.lock');

async function watcherIsActive() {
  let state;
  try { state = JSON.parse(await fs.readFile(LOCK, 'utf8')); }
  catch { return false; }
  if (!Number.isInteger(state.pid) || state.pid === process.pid) return false;
  try { process.kill(state.pid, 0); return true; }
  catch { return false; }
}

if (await watcherIsActive()) {
  // Старый монитор запускает `npm run dev` после установки новых исходников.
  // Повторный монитор создал бы конфликт lock-файла. Запускаем только Vite.
  console.log('[VERDANT AUTO] Монитор уже активен. Запускаю сервер Vite без второго наблюдателя.');
  const { createServer } = await import('vite');
  const server = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.js') });
  await server.listen();
  server.printUrls();
} else {
  console.log('[VERDANT AUTO] npm run dev теперь запускает и игру, и отслеживание ZIP.');
  await import('./auto-update.mjs');
}

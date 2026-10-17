import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

/** npm run dev = Vite + ZIP/GitHub monitor + окно Electron. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let background = null;
let desktop = null;
let stopping = false;

function closeTree(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  } catch { child.kill('SIGTERM'); }
}
function shutdown() {
  if (stopping) return;
  stopping = true;
  closeTree(desktop); closeTree(background);
}

async function waitForServer(timeout = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (background?.exitCode !== null) throw new Error('Монитор/сервер завершился до запуска Electron');
    try { const res = await fetch('http://127.0.0.1:5173/', { signal: AbortSignal.timeout(2500) }); if (res.ok) return; }
    catch { /* Vite ещё поднимается */ }
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  throw new Error('Сервер не поднялся на порту 5173 за 120 секунд');
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
try {
  const electronEntry = path.join(root, 'node_modules', 'electron', 'index.js');
  if (!fs.existsSync(electronEntry)) throw new Error('Electron отсутствует. Установите зависимости: npm install');
  background = spawn(process.execPath, [path.join(root, 'scripts', 'dev-entry.mjs')], {
    cwd: root, stdio: 'inherit', env: process.env
  });
  await waitForServer();
  const { default: electronBin } = await import('electron');
  console.log('[VERDANT DESKTOP] Запуск игры в Electron. F12 — отдельное окно DevTools.');
  desktop = spawn(electronBin, ['.'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, VERDANT_DEV_URL: 'http://127.0.0.1:5173/' }
  });
  desktop.on('exit', (code) => { shutdown(); process.exitCode = code || 0; });
  desktop.on('error', (error) => { console.error('[VERDANT DESKTOP]', error.message); shutdown(); process.exitCode = 1; });
} catch (error) {
  console.error('[VERDANT DESKTOP]', error.message);
  shutdown(); process.exitCode = 1;
}

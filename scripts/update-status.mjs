import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DOWNLOADS, archiveInfo, compareVersions, versionOfProject } from './release-manager.mjs';

/** Диагностика без изменения каких-либо файлов — npm run update:status. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOWNLOADS = process.env.VERDANT_DOWNLOADS || DEFAULT_DOWNLOADS;
const log = (...args) => console.log('[VERDANT STATUS]', ...args);

async function check() {
  log('Корень игры:', ROOT);
  const current = await versionOfProject(ROOT);
  log('Установленная версия:', current);
  log('Папка загрузок:', DOWNLOADS);
  try {
    const info = JSON.parse(await fs.readFile(path.join(ROOT, '.verdant-update/watcher.lock'), 'utf8'));
    let running = false;
    try { process.kill(info.pid, 0); running = true; } catch {}
    log('Монитор ZIP:', running ? `РАБОТАЕТ (PID ${info.pid})` : 'НЕ РАБОТАЕТ (есть устаревшая блокировка)');
  } catch {
    log('Монитор ZIP: НЕ РАБОТАЕТ. Запустите npm run dev.');
  }
  let entries;
  try { entries = await fs.readdir(DOWNLOADS); }
  catch (e) {
    log(e.code === 'ENOENT' ? 'Каталог загрузок отсутствует.' : `Ошибка доступа: ${e.message}`);
    log('Подсказка: можно задать $env:VERDANT_DOWNLOADS = "полный путь"');
    return;
  }
  const parsed=entries.map(archiveInfo).filter(Boolean).sort((a,b)=>compareVersions(b.version,a.version));
  if (!parsed.length) {
    log('Подходящих ZIP нет. Имя должно быть VERDANT_v0.1.10004_PROJECT.zip / TEXTURES_1K.zip');
    return;
  }
  for (const file of parsed) {
    log(`${file.filename}: ${compareVersions(file.version,current)>0 ? 'ожидает установки' : file.version===current ? 'версия уже установлена' : 'старая версия'}`);
  }
  const newest = parsed.find(a => a.kind==='PROJECT' && compareVersions(a.version,current)>0);
  if (newest && !parsed.some(a=>a.kind==='TEXTURES_1K'&&a.version===newest.version))
    log(`ВНИМАНИЕ: для ${newest.version} отсутствует архив TEXTURES_1K. Монитор ждёт оба архива.`);
  if (entries.some(s=>/VERDANT.*\(\d+\).*\.zip$/i.test(s)))
    log('ВНИМАНИЕ: Windows добавил суффикс (1)/(2) к ZIP. Переименуйте без него.');
}

check().catch(e=>{console.error('[VERDANT STATUS]',e.message);process.exitCode=1;});

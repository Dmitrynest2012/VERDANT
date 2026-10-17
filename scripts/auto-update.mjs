import fs from 'node:fs/promises';
import { existsSync, watch } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DOWNLOADS, archiveInfo, compareVersions, readState, versionOfProject,
  installRelease, cleanupOldArchives
} from './release-manager.mjs';
import { fetchLatestGitHubRelease, downloadGitHubRelease, GH_OWNER, GH_REPO } from './github-release.mjs';

/**
 * «npm run dev» и «npm run auto:update» — один монитор управляет сервером Vite
 * и проверяет каталог ZIP. Выбор только по именам VERDANT_vX.Y.Z_*.zip.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOWNLOADS = process.env.VERDANT_DOWNLOADS || DEFAULT_DOWNLOADS;
const POLL_MS = 4000;
const GITHUB_POLL_MS = 5 * 60 * 1000;
const STATE_DIR = path.join(ROOT, '.verdant-update');
const LOCK = path.join(STATE_DIR, 'watcher.lock');
const STABLE_AGE_MS = 1800;
const seen = new Map();
const failures = new Map();
let dev = null;
let updating = false;
let closed = false;
let busy = false;
let watcher = null;
let lockOwned = false;
let lastWaiting = '';
let githubBusy = false;
let githubErrors = new Set();

function waiting(message) {
  if (lastWaiting === message) return;
  lastWaiting = message;
  if (message) log(message);
}

const log = (...args) => console.log('[VERDANT AUTO]', ...args);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = data => createHash('sha256').update(data).digest('hex');

/** Запускаем npm его собственным JS-файлом: пробелы в путях Windows не ломают аргументы. */
function npmCommand(args, cwd = ROOT, background = false) {
  const cli = process.env.npm_execpath;
  const executable = cli && existsSync(cli) ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const argv = cli && existsSync(cli) ? [cli, ...args] : args;
  const options = {
    cwd, stdio: 'inherit', env: process.env, windowsHide: false,
    detached: background && process.platform !== 'win32',
    // Если npm_execpath не определён в Windows, .cmd нужно запускать через shell.
    shell: !(cli && existsSync(cli)) && process.platform === 'win32'
  };
  return spawn(executable, argv, options);
}

function checkedNpm(args, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    log('Выполняется:', `npm ${args.join(' ')}`);
    const child = npmCommand(args, cwd, false);
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(' ')} завершился: ${signal || code}`));
    });
  });
}

async function startDev() {
  if (closed || dev) return;
  if (!existsSync(path.join(ROOT, 'node_modules'))) {
    log('Нет node_modules — устанавливаю зависимости. При необходимости включите VPN.');
    try { await checkedNpm(['install', '--no-audit', '--no-fund']); }
    catch (e) { log('Ошибка npm install:', e.message); return; }
  }
  if (closed) return;
  log('Запускаю Vite: http://127.0.0.1:5173/');
  const child = npmCommand(['run', 'dev:server'], ROOT, true);
  dev = child;
  child.on('error', e => log('Ошибка сервера:', e.message));
  child.on('exit', (code) => {
    if (dev === child) dev = null;
    if (!updating && !closed) log(`Vite завершился (${code}). Для повтора нажмите Ctrl+C и снова npm run auto:update.`);
  });
}

async function stopDev() {
  const child = dev;
  if (!child || !child.pid) { dev = null; return; }
  dev = null;
  const stopped = new Promise(resolve => child.once('exit', resolve));
  try {
    if (process.platform === 'win32') {
      // taskkill закрывает И npm-команду, И дочерний Vite; порт не остаётся занятым.
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); }
      catch { child.kill('SIGTERM'); }
    }
  } catch (e) { log('Остановка Vite:', e.message); }
  await Promise.race([stopped, pause(4500)]);
}

async function obtainLock() {
  await fs.mkdir(STATE_DIR, { recursive: true });
  try {
    const current = JSON.parse(await fs.readFile(LOCK, 'utf8'));
    const age = Date.now() - Number(current.started || 0);
    if (Number.isInteger(current.pid) && age < 7 * 24 * 3600000) {
      let alive = false;
      try { process.kill(current.pid, 0); alive = true; } catch {}
      if (alive) throw new Error(`Монитор уже запущен (PID ${current.pid}). Второй запуск запрещён.`);
    }
    await fs.rm(LOCK, { force: true });
  } catch (e) { if (e.code !== 'ENOENT' && !e.message.includes('Unexpected')) throw e; }
  const f = await fs.open(LOCK, 'wx');
  try { await f.writeFile(JSON.stringify({ pid: process.pid, started: Date.now() })); }
  finally { await f.close(); }
  lockOwned = true;
}

async function getStableArchives() {
  let entries;
  try { entries = await fs.readdir(DOWNLOADS, { withFileTypes: true }); }
  catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parsed = archiveInfo(entry.name);
    if (!parsed) continue;
    const absolute = path.join(DOWNLOADS, entry.name);
    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat?.isFile()) continue;
    const signature = `${stat.size}|${stat.mtimeMs}`;
    const history = seen.get(entry.name);
    const observed = history?.signature === signature ? history.observed + 1 : 1;
    seen.set(entry.name, { signature, observed });
    found.push({ ...parsed, absolute, stable: observed >= 2 && Date.now() - stat.mtimeMs >= STABLE_AGE_MS });
  }
  return found;
}

async function fingerprint(archive) {
  // Сравнение содержимого надёжнее времени изменения и размера.
  return sha256(await fs.readFile(archive.absolute));
}

async function checkForUpdates() {
  if (busy || closed) return;
  busy = true;
  try {
    const archives = await getStableArchives();
    const state = await readState(ROOT);
    const installedVersion = await versionOfProject(ROOT);
    const validProjects = archives.filter(a => a.kind === 'PROJECT' && compareVersions(a.version, installedVersion) > 0);
    validProjects.sort((a,b) => compareVersions(b.version,a.version));
    const newest = validProjects[0];
    if (newest) {
      // Если пара уже скачивается — дождёмся её, чтобы сделать одну установку.
      const companion = archives.find(a => a.kind === 'TEXTURES_1K' && a.version === newest.version);
      // В VERDANT код и 1K-контент — единая пара релиза.
      // Не устанавливаем половину поставки: в противном случае материалы
      // новых блоков отсутствовали бы, а игра могла выглядеть неисправной.
      if (!companion) { waiting(`Найден ${newest.filename}. Ожидаю VERDANT_v${newest.version}_TEXTURES_1K.zip.`); return; }
      if (!newest.stable || !companion.stable) { waiting('Ожидаю завершения загрузки/копирования обоих ZIP…'); return; }
      waiting('');
      await deploy(newest, companion);
      return;
    }
    waiting('');
    const matching = archives.find(a => a.kind === 'TEXTURES_1K' && a.version === installedVersion && a.stable);
    if (matching && await fingerprint(matching) !== state.textureHash) await deploy(null, matching);
  } catch (e) {
    log('Монитор:', e.message);
  } finally { busy = false; }
}

/** GitHub + локальные ZIP используют ОДНУ транзакционную установку. */
async function checkGithub() {
  if (githubBusy || updating || busy || closed || process.env.VERDANT_GITHUB_UPDATES === '0') return;
  githubBusy = true;
  try {
    const installed = await versionOfProject(ROOT);
    const release = await fetchLatestGitHubRelease(installed);
    if (!release) return;
    log(`GitHub: версия ${release.version} доступна — загружаю отдельные PROJECT и TEXTURES_1K…`);
    const files = await downloadGitHubRelease(release, path.join(STATE_DIR, 'github-downloads'));
    await deploy(
      { filename: path.basename(files.project), absolute: files.project },
      { filename: path.basename(files.texture), absolute: files.texture }
    );
  } catch (e) {
    if (!githubErrors.has(e.message)) {
      githubErrors.add(e.message);
      log('GitHub: обновление пока недоступно:', e.message);
    }
  } finally { githubBusy = false; }
}

async function deploy(project, texture) {
  const identity = `${project?.filename || ''}|${texture?.filename || ''}`;
  const hash = sha256(Buffer.from([project ? await fingerprint(project) : '', texture ? await fingerprint(texture) : ''].join('|')));
  const failure = failures.get(identity);
  if (failure?.hash === hash && Date.now() - failure.at < 60000) return;
  log('Найден новый релиз:', project?.filename || '', texture?.filename || '');
  updating = true;
  await stopDev();
  try {
    const summary = await installRelease({
      root: ROOT,
      projectArchive: project?.absolute || null,
      textureArchive: texture?.absolute || null,
      runChecks: async ({ install }) => {
        if (install) await checkedNpm(['install', '--no-audit', '--no-fund']);
        await checkedNpm(['test']);
        await checkedNpm(['run','build']);
      }
    });
    log(`Успешно: версия ${summary.version}, обновлено файлов ${summary.filesWritten}, убрано устаревших ${summary.filesRemoved}.`);
    const deleteOld = process.env.VERDANT_CLEANUP_OLD_ARCHIVES !== '0';
    if (deleteOld) {
      try {
        const removed = await cleanupOldArchives(DOWNLOADS, summary.version);
        if (removed) log('Удалено архивов предыдущих версий VERDANT:', removed);
      } catch (e) {
        log('Релиз установлен, но очистка старых архивов не удалась:', e.message);
      }
    }
    failures.delete(identity);
    await fs.rm(path.join(STATE_DIR, 'github-downloads'), { recursive: true, force: true }).catch(() => {});
  } catch (error) {
    log('Релиз не применён:', error.message);
    failures.set(identity, {hash, at:Date.now()});
  } finally {
    updating = false;
    await startDev();
  }
}

async function shutDown() {
  if (closed) return;
  closed = true;
  if (watcher) watcher.close();
  await stopDev();
  if (lockOwned) await fs.rm(LOCK, { force: true });
  process.exit(0);
}

async function main() {
  await obtainLock();
  log('Версия в папке:', await versionOfProject(ROOT));
  log('Папка с ZIP:', DOWNLOADS);
  log('Монитор ZIP активен: проверка каждые 4 секунды, Vite запускается автоматически.');
  log(`GitHub Releases: ${GH_OWNER}/${GH_REPO}, проверка каждые 5 минут (без доступа к чатам ChatGPT).`);
  log('Управление: Ctrl+C завершает монитор и сервер Vite.');
  if (!existsSync(DOWNLOADS)) {
    log('Каталог загрузок пока не обнаружен. Vite запускается, монитор продолжает ждать каталог.');
  }
  await getStableArchives();
  await pause(1900);
  await checkForUpdates();
  await startDev();
  setInterval(checkForUpdates, POLL_MS);
  setTimeout(checkGithub, 15000);
  setInterval(checkGithub, GITHUB_POLL_MS);
  try {
    watcher = watch(DOWNLOADS, () => setTimeout(checkForUpdates, 2400));
    watcher.on('error', e => log('fs.watch:', e.message, '— остаётся опрос раз в 4 секунды.'));
  } catch { /* каталога пока нет: опрос всё равно работает */ }
  process.once('SIGINT', shutDown);
  process.once('SIGTERM', shutDown);
}

main().catch(error => {
  console.error('[VERDANT AUTO] Запуск не удался:', error.message);
  process.exitCode = 1;
});

import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { readZipFile, flattenSingleFolder, safeZipPath } from './zip-safe.mjs';

/** Только архивы нашей игры; чужие ZIP не трогаем ни при установке, ни при очистке. */
export const RELEASE_REGEX = /^VERDANT_v(\d+\.\d+\.\d+)_(PROJECT|TEXTURES_1K)\.zip$/i;
export const DEFAULT_DOWNLOADS = String.raw`D:\Sphere\Titan_3070\user Dmitry Nesterov\Downloads\Downloads_00_All`;

export function archiveInfo(filename) {
  const m = RELEASE_REGEX.exec(filename);
  return m ? { version: m[1], kind: m[2].toUpperCase(), filename } : null;
}

export function compareVersions(a, b) {
  const aa = String(a || '0.0.0').split('.').map(Number);
  const bb = String(b || '0.0.0').split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1;
  return 0;
}

const sha256 = data => createHash('sha256').update(data).digest('hex');

/** Разрешены файлы исходников; картинки, аудио и личные папки — не из проектного ZIP. */
export function isAllowedProjectFile(name) {
  if (name === 'package.json' || name === 'package-lock.json' || name === 'index.html' ||
      name === '.gitignore' || name === 'README.md' || name === 'CHANGELOG.md') return true;
  if (/^docs\/[\w-]+\.md$/i.test(name) || /^tests\/[\w.-]+\.(mjs|js)$/i.test(name) ||
      /^scripts\/[\w.-]+\.(mjs|js|json|py)$/i.test(name) ||
       /^src\/[\w./-]+\.(js|mjs|css|json)$/i.test(name) ||
      /^electron\/[\w.-]+\.(cjs|js)$/i.test(name) ||
      /^\.github\/workflows\/[\w.-]+\.ya?ml$/i.test(name) ||
      /^\.vscode\/tasks\.json$/i.test(name) ||
      /^public\/(?:audio|textures)\/README\.md$/i.test(name) ||
      /^vite\.config\.(?:js|mjs)$/i.test(name)) return true;
  return false;
}

function projectFiles(zip, version) {
  const files = flattenSingleFolder(zip);
  if (!files.has('package.json') || !files.has('index.html') || !files.has('src/main.js')) {
    throw new Error('Проектный ZIP должен содержать package.json, index.html и src/main.js');
  }
  let data;
  try { data = JSON.parse(files.get('package.json').toString('utf8')); }
  catch { throw new Error('Некорректный package.json в ZIP'); }
  if (data.name !== 'verdant-voxel' || data.version !== version) {
    throw new Error(`Неверная версия/имя в package.json (ожидалось ${version})`);
  }
  for (const file of files.keys()) {
    if (!isAllowedProjectFile(file)) throw new Error(`Недопустимый файл в ZIP проекта: ${file}`);
  }
  return files;
}

/** Все графические файлы идут ТОЛЬКО в public/textures, без архивной обёртки. */
function textureFiles(zip) {
  const flat = flattenSingleFolder(zip);
  const files = new Map();
  for (const [original, content] of flat) {
    if (original === 'README.md') continue;
    const file = original.replace(/^public\/textures\//, '').replace(/^textures\//, '');
    if (!/^[a-z0-9_-]+\.(png|jpg|jpeg|webp)$/i.test(file)) {
      throw new Error(`Недопустимое содержимое текстурного ZIP: ${original}`);
    }
    const dest = `public/textures/${file}`;
    if (files.has(dest)) throw new Error('Повтор текстуры: ' + file);
    if (file.toLowerCase().endsWith('.png') && !content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
      throw new Error('Неверный PNG: ' + file);
    }
    files.set(dest, content);
  }
  if (!files.size) throw new Error('Текстурный ZIP не содержит графики');
  return files;
}

export async function readState(root) {
  let state = {};
  try { state = JSON.parse(await fs.readFile(path.join(root, '.verdant-update/state.json'), 'utf8')); }
  catch { /* Первый запуск без state.json — нормальная ситуация. */ }
  // Подхватываем манифест первого вручную распакованного релиза 0.1.1.
  // Благодаря этому следующий автоматический релиз удалит и устаревшие
  // файлы исходников из первоначальной установки, не трогая посторонние.
  if (!Array.isArray(state.managedProjectFiles)) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(root, 'scripts/release-files.json'), 'utf8'));
      const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
      if (manifest.version === pkg.version && Array.isArray(manifest.files)) {
        state.managedProjectFiles = manifest.files.filter(isAllowedProjectFile);
      }
    } catch { /* Архивы до 0.1.1 не содержали манифест. */ }
  }
  return state;
}

export async function versionOfProject(root) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (pkg.name !== 'verdant-voxel') throw new Error('Корневая папка не является проектом VERDANT');
  return pkg.version;
}

/** Не позволяем ZIP разыменовать символическую ссылку за пределы проекта. */
export async function assertSafeDestination(root, relative) {
  safeZipPath(relative);
  const resolvedRoot = path.resolve(root);
  const full = path.resolve(resolvedRoot, ...relative.split('/'));
  if (!full.startsWith(resolvedRoot + path.sep)) throw new Error('Выход за границу проекта: ' + relative);
  let current = resolvedRoot;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Символическая ссылка заблокирована: ' + relative); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return full;
}

async function writeFileAtomic(dest, bytes) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.verdant-new-${process.pid}`;
  try { await fs.writeFile(tmp, bytes); await fs.rename(tmp, dest); }
  finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
}

/**
 * Обновление с откатом. Перед вызовом остановить Vite; после — запустить его.
 * runChecks: async({install,root}) => npm install/test/build, подменяется в тестах.
 */
export async function installRelease({ root, projectArchive = null, textureArchive = null, runChecks = async () => {} }) {
  if (!projectArchive && !textureArchive) throw new Error('Не указан архив релиза');
  root = path.resolve(root);
  const oldState = await readState(root);
  const actualVersion = await versionOfProject(root);
  // При ручной установке PROJECT.zip package.json уже новой версии,
  // но state.json остаётся от предыдущей. В таком случае установка
  // TEXTURES_1K той же новой версии обязана работать, а не падать с
  // «Текстуры и проект имеют разные версии».
  const oldVersion = oldState.version && compareVersions(oldState.version, actualVersion) > 0
    ? oldState.version : actualVersion;
  const projectInfo = projectArchive ? archiveInfo(path.basename(projectArchive)) : null;
  const textureInfo = textureArchive ? archiveInfo(path.basename(textureArchive)) : null;
  if (projectArchive && projectInfo?.kind !== 'PROJECT') throw new Error('Ожидается VERDANT_vX.Y.Z_PROJECT.zip');
  if (textureArchive && textureInfo?.kind !== 'TEXTURES_1K') throw new Error('Ожидается VERDANT_vX.Y.Z_TEXTURES_1K.zip');
  const nextVersion = projectInfo?.version || oldVersion;
  if (compareVersions(nextVersion, oldVersion) < 0) throw new Error('Откат на старую версию запрещён');
  if (textureInfo && textureInfo.version !== nextVersion) throw new Error('Текстуры и проект имеют разные версии');

  const plans = new Map();
  const nextState = structuredClone(oldState);
  if (projectArchive) {
    const files = projectFiles(await readZipFile(projectArchive, { maxSingle: 16*1024*1024, maxTotal: 80*1024*1024 }), nextVersion);
    for (const [name, content] of files) plans.set(name, content);
    nextState.managedProjectFiles = [...files.keys()];
    nextState.projectHash = sha256(await fs.readFile(projectArchive));
  }
  if (textureArchive) {
    const files = textureFiles(await readZipFile(textureArchive, { maxSingle: 64*1024*1024, maxTotal: 200*1024*1024, maxCompressed: 220*1024*1024 }));
    for (const [name, content] of files) plans.set(name, content);
    nextState.managedTextureFiles = [...files.keys()];
    nextState.textureHash = sha256(await fs.readFile(textureArchive));
  }
  nextState.version = nextVersion;
  nextState.updatedAt = new Date().toISOString();

  // Убираем только файлы, внесённые нашим предыдущим обновлением.
  const removed = [];
  if (projectArchive) for (const name of oldState.managedProjectFiles ?? []) {
    if (!plans.has(name) && isAllowedProjectFile(name)) removed.push(name);
  }
  if (textureArchive) for (const name of oldState.managedTextureFiles ?? []) {
    if (!plans.has(name) && /^public\/textures\/[a-z0-9_-]+\.(?:png|jpg|jpeg|webp)$/i.test(name)) removed.push(name);
  }

  const all = [...new Set([...plans.keys(), ...removed])];
  const back = new Map();
  for (const relative of all) {
    const dest = await assertSafeDestination(root, relative);
    try { back.set(relative, await fs.readFile(dest)); }
    catch (e) { if (e.code === 'ENOENT') back.set(relative, null); else throw e; }
  }
  const work = path.join(root, '.verdant-update');
  const rollbackTmp = path.join(work, 'rollback-working');
  await fs.mkdir(work, { recursive: true });
  await fs.rm(rollbackTmp, { recursive: true, force: true });
  await fs.mkdir(rollbackTmp, { recursive: true });
  const metadata = { priorState: oldState, entries: [] };
  for (const [relative, content] of back) {
    metadata.entries.push({ path: relative, present: content !== null });
    if (content !== null) {
      const target = path.join(rollbackTmp, 'files', ...relative.split('/'));
      await fs.mkdir(path.dirname(target), {recursive:true});
      await fs.writeFile(target, content);
    }
  }
  await fs.writeFile(path.join(rollbackTmp, 'manifest.json'), JSON.stringify(metadata,null,2));

  try {
    for (const [relative, content] of plans) {
      const dest = await assertSafeDestination(root, relative);
      await writeFileAtomic(dest, content);
    }
    for (const relative of removed) await fs.rm(await assertSafeDestination(root, relative), { force: true });
    // npm install только при смене зависимостей либо отсутствии node_modules;
    // тесты и production-сборка выполняются при каждом релизе исходников.
    let dependencyChange = false;
    if (projectArchive) {
      const previous = back.get('package.json');
      try {
        const oldPkg = previous ? JSON.parse(previous.toString('utf8')) : {};
        const newPkg = JSON.parse(plans.get('package.json').toString('utf8'));
        dependencyChange = JSON.stringify([oldPkg.dependencies, oldPkg.devDependencies]) !==
          JSON.stringify([newPkg.dependencies, newPkg.devDependencies]);
      } catch { dependencyChange = true; }
    }
    if (projectArchive && plans.has('package-lock.json')) {
      const previousLock = back.get('package-lock.json');
      dependencyChange ||= !previousLock || !previousLock.equals(plans.get('package-lock.json'));
    }
    const install = (projectArchive && dependencyChange) || !existsSync(path.join(root, 'node_modules'));
    await runChecks({ root, install });
    // Храним только один предыдущий комплект заменённых файлов, без накопления мусора.
    await fs.rm(path.join(work, 'previous'), { recursive: true, force: true });
    await fs.rename(rollbackTmp, path.join(work, 'previous'));
    // State записываем ПОСЛЕДНИМ: иначе неудача копирования резервной
    // версии пометила бы незавершённое обновление как успешное.
    await writeFileAtomic(path.join(work, 'state.json'), Buffer.from(JSON.stringify(nextState,null,2)));
    return { version: nextVersion, filesWritten: plans.size, filesRemoved: removed.length, installed: Boolean(install) };
  } catch (error) {
    for (const [relative, content] of back) {
      const dest = await assertSafeDestination(root, relative);
      if (content === null) await fs.rm(dest, { force: true });
      else await writeFileAtomic(dest, content);
    }
    await fs.rm(rollbackTmp, { recursive: true, force: true });
    throw new Error('Установка отменена, файлы проекта возвращены: ' + error.message, { cause: error });
  }
}

export async function cleanupOldArchives(downloads, installedVersion) {
  let deleted = 0;
  let list;
  try { list = await fs.readdir(downloads); }
  catch (e) { if (e.code === 'ENOENT') return 0; throw e; }
  for (const name of list) {
    const info = archiveInfo(name);
    // Ни текущую версию, ни неродственные ZIP никогда не удаляем.
    if (info && compareVersions(info.version, installedVersion) < 0) {
      await fs.rm(path.join(downloads, name), { force: true });
      deleted++;
    }
  }
  return deleted;
}

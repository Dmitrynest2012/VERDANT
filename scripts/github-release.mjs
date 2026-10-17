import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { compareVersions } from './release-manager.mjs';

/**
 * GitHub — официальный источник релизов VERDANT.
 * Публичный репозиторий не требует токена на компьютере игрока.
 * Ни один ZIP не устанавливается, пока не проверены две части и SHA-256.
 */
export const GH_OWNER = 'Dmitrynest2012';
export const GH_REPO = 'VERDANT';
export const GH_API = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/latest`;

const ALLOWED_ASSET_HOSTS = new Set([
  'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com',
  'api.github.com'
]);

function safeAssetUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || !ALLOWED_ASSET_HOSTS.has(u.hostname)) {
    throw new Error(`Недопустимый адрес релизного файла: ${u.hostname}`);
  }
  return u.toString();
}

const SHA256 = /^[a-f0-9]{64}$/i;

function releasePart(assets, version, kind) {
  const name = `VERDANT_v${version}_${kind}.zip`;
  const matching = assets.filter(asset => asset?.name === name);
  if (matching.length !== 1) throw new Error(`В GitHub Release отсутствует ${name}`);
  const item = matching[0];
  if (!Number.isSafeInteger(item.size) || item.size < 100 || item.size > (kind === 'PROJECT' ? 80 : 220) * 1024 * 1024) {
    throw new Error(`Недопустимый размер архива ${name}`);
  }
  return { name, size: item.size, url: safeAssetUrl(item.browser_download_url), digest: item.digest || null };
}

export function parseGitHubRelease(data, installedVersion) {
  if (!data || typeof data !== 'object' || data.draft || data.prerelease) return null;
  const version = String(data.tag_name || '').match(/^v(\d+\.\d+\.\d+)$/)?.[1];
  if (!version || compareVersions(version, installedVersion) <= 0) return null;
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const project = releasePart(assets, version, 'PROJECT');
  const texture = releasePart(assets, version, 'TEXTURES_1K');
  const checksum = assets.find(a => a.name === 'SHA256SUMS.txt');
  return {
    version,
    project,
    texture,
    checksum: checksum ? { url: safeAssetUrl(checksum.browser_download_url) } : null
  };
}

export async function fetchLatestGitHubRelease(installedVersion, fetchFn = fetch) {
  const res = await fetchFn(GH_API, {
    headers: { 'Accept':'application/vnd.github+json', 'User-Agent':'VERDANT-Updater' },
    signal: AbortSignal.timeout(9000)
  });
  if (res.status === 404) return null; // До первого GitHub Release — штатная ситуация.
  if (!res.ok) throw new Error(`GitHub ответил HTTP ${res.status}`);
  return parseGitHubRelease(await res.json(), installedVersion);
}

async function expectedHashes(release, fetchFn) {
  const parts = [release.project, release.texture];
  let sums = null;
  if (release.checksum) {
    const response = await fetchFn(release.checksum.url, { signal: AbortSignal.timeout(16000) });
    if (!response.ok) throw new Error('Не удалось прочитать контрольные суммы релиза');
    const txt = await response.text();
    if (txt.length > 10000) throw new Error('Чрезмерно большой список контрольных сумм');
    sums = new Map();
    for (const line of txt.split(/\r?\n/)) {
      const match = line.match(/^([a-f0-9]{64})\s+\*?([^\\/\s]+)$/i);
      if (match) sums.set(match[2], match[1].toLowerCase());
    }
  }
  for (const p of parts) {
    const fromDigest = p.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1]?.toLowerCase();
    const fromSum = sums?.get(p.name);
    if (!fromDigest && !fromSum) throw new Error(`Нельзя подтвердить SHA-256 архива ${p.name}`);
    if (fromDigest && fromSum && fromDigest !== fromSum) throw new Error(`Контрольные суммы GitHub не совпадают: ${p.name}`);
    p.expectedHash = fromDigest || fromSum;
  }
}

async function fetchVerifiedAsset(asset, folder, fetchFn) {
  const response = await fetchFn(asset.url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok || !response.body) throw new Error(`Не удалось скачать ${asset.name} (HTTP ${response.status})`);
  if (response.url) safeAssetUrl(response.url);
  const parts = [];
  let total = 0;
  for await (const part of response.body) {
    total += part.byteLength;
    if (total > asset.size || total > 230*1024*1024) throw new Error(`Превышен размер ${asset.name}`);
    parts.push(Buffer.from(part));
  }
  if (total !== asset.size) throw new Error(`ZIP скачан не полностью: ${asset.name}`);
  const bytes = Buffer.concat(parts);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== asset.expectedHash) throw new Error(`SHA-256 не совпал: ${asset.name}`);
  const dest = path.join(folder, asset.name);
  await fs.writeFile(dest + '.partial', bytes);
  await fs.rename(dest + '.partial', dest);
  return dest;
}

/** Архивы возвращаются только после проверки SHA-256 обеих частей. */
export async function downloadGitHubRelease(release, tempDir, fetchFn = fetch) {
  await expectedHashes(release, fetchFn);
  const dir = path.join(tempDir, release.version);
  await fs.mkdir(dir, { recursive: true });
  try {
    const project = await fetchVerifiedAsset(release.project, dir, fetchFn);
    const texture = await fetchVerifiedAsset(release.texture, dir, fetchFn);
    return { project, texture };
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true });
    throw error;
  }
}

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const unquote = value => value.trim().replace(/^(['"])(.*)\1$/, '$2');
const values = (text, re) => [...text.matchAll(re)].map(m => unquote(m[1]));
async function digest(file, algorithm) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(algorithm === 'sha512' ? 'base64' : 'hex');
}

/** Проверяем не просто наличие EXE, а согласованность именно канала Electron. */
export async function verifyDesktopRelease(root) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const version = pkg.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
  const dir = path.join(root, 'dist-release');
  const filename = `VERDANT-Setup-${version}.exe`;
  const exe = path.join(dir, filename);
  const size = (await fs.stat(exe)).size;
  const head = await fs.open(exe, 'r');
  try {
    const bytes = Buffer.alloc(2);
    await head.read(bytes, 0, 2, 0);
    if (bytes.toString('ascii') !== 'MZ' || size < 1024) throw new Error('Invalid Windows installer');
  } finally { await head.close(); }
  const text = (await fs.readFile(path.join(dir, 'latest.yml'), 'utf8')).replace(/\r\n?/g, '\n');
  if (values(text, /^version:\s*([^\n]+)$/gm)[0] !== version) throw new Error('latest.yml version mismatch');
  const names = values(text, /^\s*(?:-\s+url|path):\s*([^\n]+)$/gm);
  if (names.length < 2 || names.some(v => decodeURIComponent(v) !== filename)) throw new Error('latest.yml installer path mismatch');
  const expectedHash = await digest(exe, 'sha512');
  const hashes = values(text, /^\s*sha512:\s*([^\n]+)$/gm);
  if (!hashes.length || hashes.some(v => v !== expectedHash)) throw new Error('latest.yml SHA512 mismatch');
  const sizes = values(text, /^\s*size:\s*([^\n]+)$/gm);
  if (!sizes.length || sizes.some(v => Number(v) !== size)) throw new Error('latest.yml installer size mismatch');
  const blockmap = `${exe}.blockmap`;
  if (!(await fs.stat(blockmap)).size) throw new Error('Missing blockmap');
  const feed = await fs.readFile(path.join(dir, 'win-unpacked/resources/app-update.yml'), 'utf8');
  for (const [key, expected] of [['provider','github'], ['owner','Dmitrynest2012'], ['repo','VERDANT']]) {
    if (values(feed, new RegExp(`^${key}:\\s*([^\\r\\n]+)$`, 'gm'))[0] !== expected) throw new Error(`Wrong installed update provider: ${key}`);
  }
  return { version, filename, size, sha512: expectedHash };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const result = await verifyDesktopRelease(root);
    console.log('[VERDANT DESKTOP CHECK] OK', JSON.stringify(result));
    const lines = [];
    for (const name of [result.filename, `${result.filename}.blockmap`, 'latest.yml']) {
      lines.push(`${await digest(path.join(root, 'dist-release', name), 'sha256')}  ${name}\n`);
    }
    await fs.appendFile(path.join(root, 'SHA256SUMS.txt'), lines.join(''), 'utf8');
  } catch (error) {
    console.error('[VERDANT DESKTOP CHECK]', error.message);
    process.exitCode = 1;
  }
}

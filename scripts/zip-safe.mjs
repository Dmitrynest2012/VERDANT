import { inflateRawSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';

/** Извлечение ZIP без внешних библиотек. Проверяем пути, CRC, размер и типы файлов. */
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}

export function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export function safeZipPath(name) {
  if (typeof name !== 'string' || !name || name.length > 240 || name.includes('\\') ||
      name.startsWith('/') || name.startsWith('~') || name.includes('\0') ||
      /^[A-Za-z]:/.test(name)) throw new Error(`Недопустимый путь ZIP: ${name}`);
  const clean = name.endsWith('/') ? name.slice(0, -1) : name;
  const segments = clean.split('/');
  if (segments.some(part => !part || part === '.' || part === '..' || /[:<>"|?*]/.test(part) ||
      /[. ]$/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))) {
    throw new Error(`Опасный путь в ZIP: ${name}`);
  }
  return clean;
}

export function readZip(buffer, limits = {}) {
  const maxFiles = limits.maxFiles ?? 2000;
  const maxTotal = limits.maxTotal ?? 160 * 1024 * 1024;
  const maxSingle = limits.maxSingle ?? 32 * 1024 * 1024;
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.length > (limits.maxCompressed ?? 180 * 1024 * 1024)) {
    throw new Error('ZIP слишком велик для безопасной распаковки');
  }
  let eocd = -1;
  const from = Math.max(0, bytes.length - 22 - 65535);
  for (let p = bytes.length - 22; p >= from; p--) {
    if (bytes.readUInt32LE(p) === 0x06054B50 && p + 22 + bytes.readUInt16LE(p + 20) === bytes.length) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP повреждён: отсутствует центральный каталог');
  const disk = bytes.readUInt16LE(eocd + 4);
  const count = bytes.readUInt16LE(eocd + 10);
  const directoryLength = bytes.readUInt32LE(eocd + 12);
  const directoryStart = bytes.readUInt32LE(eocd + 16);
  if (disk !== 0 || bytes.readUInt16LE(eocd + 6) !== 0 || count !== bytes.readUInt16LE(eocd + 8) ||
      count === 0xFFFF || directoryStart === 0xFFFFFFFF || directoryLength === 0xFFFFFFFF ||
      count > maxFiles || directoryStart + directoryLength > eocd) {
    throw new Error('ZIP не поддерживается (многотомный/Zip64/слишком много файлов)');
  }
  const out = new Map();
  let total = 0;
  let cursor = directoryStart;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > directoryStart + directoryLength || bytes.readUInt32LE(cursor) !== 0x02014B50) {
      throw new Error('ZIP: повреждена запись центрального каталога');
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const checksum = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const uncompressed = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const external = bytes.readUInt32LE(cursor + 38);
    const offset = bytes.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > directoryStart + directoryLength || compressed === 0xFFFFFFFF || uncompressed === 0xFFFFFFFF ||
        offset === 0xFFFFFFFF || flags & 1 || (method !== 0 && method !== 8)) {
      throw new Error('ZIP: неподдерживаемое или зашифрованное содержимое');
    }
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    safeZipPath(name);
    const fileKind = (external >>> 16) & 0xF000;
    if (fileKind === 0xA000) throw new Error('ZIP содержит символическую ссылку: ' + name);
    if (!name.endsWith('/')) {
      if (out.has(name)) throw new Error('ZIP содержит повторяющиеся файлы: ' + name);
      total += uncompressed;
      if (uncompressed > maxSingle || total > maxTotal) throw new Error('ZIP: превышен безопасный размер распаковки');
      if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034B50) {
        throw new Error('ZIP: не найдены данные файла ' + name);
      }
      const localName = bytes.readUInt16LE(offset + 26);
      const localExtra = bytes.readUInt16LE(offset + 28);
      const payloadStart = offset + 30 + localName + localExtra;
      if (payloadStart + compressed > directoryStart) throw new Error('ZIP: повреждено содержимое ' + name);
      const packed = bytes.subarray(payloadStart, payloadStart + compressed);
      const data = method === 0 ? Buffer.from(packed) : inflateRawSync(packed, { maxOutputLength: maxSingle });
      if (data.length !== uncompressed || crc32(data) !== checksum) {
        throw new Error('ZIP: проверка размера / CRC32 не пройдена: ' + name);
      }
      out.set(name, data);
    }
    cursor = end;
  }
  if (cursor !== directoryStart + directoryLength) throw new Error('ZIP: неточное окончание каталога');
  return out;
}

export async function readZipFile(file, limits = {}) { return readZip(await readFile(file), limits); }

/** Убрать единственный внешний каталог, если весь ZIP лежит в нём. */
export function flattenSingleFolder(entries) {
  const paths = [...entries.keys()];
  if (!paths.length) throw new Error('ZIP пустой');
  const root = paths[0].split('/')[0];
  const prefix = root + '/';
  if (!paths.every(p => p.startsWith(prefix))) return entries;
  const flat = new Map();
  for (const [key, value] of entries) {
    const name = key.slice(prefix.length);
    safeZipPath(name);
    if (flat.has(name)) throw new Error('ZIP: повтор после распаковки корневой папки');
    flat.set(name, value);
  }
  return flat;
}

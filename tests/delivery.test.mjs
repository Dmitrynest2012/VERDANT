import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyDesktopRelease } from '../scripts/verify-desktop-release.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verdant-feed-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'dist-release');
  await fs.mkdir(path.join(dir, 'win-unpacked/resources'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({version:'0.1.10006'}));
  const exe = Buffer.alloc(2048, 1); exe.write('MZ');
  const hash = createHash('sha512').update(exe).digest('base64');
  const name = 'VERDANT-Setup-0.1.10006.exe';
  await fs.writeFile(path.join(dir, name), exe);
  await fs.writeFile(path.join(dir, name + '.blockmap'), 'map');
  const feed = `version: 0.1.10006\nfiles:\n  - url: ${name}\n    sha512: ${hash}\n    size: 2048\npath: ${name}\nsha512: ${hash}\n`;
  await fs.writeFile(path.join(dir, 'latest.yml'), feed.replaceAll('\n','\r\n'));
  await fs.writeFile(path.join(dir, 'win-unpacked/resources/app-update.yml'), 'provider: github\nowner: Dmitrynest2012\nrepo: VERDANT\n');
  return {root, dir, feed, name};
}

test('Electron delivery: EXE, latest.yml, checksum and installed provider agree', async t => {
  const {root} = await fixture(t);
  assert.equal((await verifyDesktopRelease(root)).version, '0.1.10006');
});
test('Electron delivery rejects a stale latest.yml', async t => {
  const {root,dir,feed} = await fixture(t);
  await fs.writeFile(path.join(dir,'latest.yml'), feed.replace('version: 0.1.10006','version: 0.1.10005'));
  await assert.rejects(verifyDesktopRelease(root), /version mismatch/);
});
test('Electron delivery rejects damaged installer bytes', async t => {
  const {root,dir,name} = await fixture(t);
  const file = path.join(dir,name); const bytes = await fs.readFile(file); bytes[99] ^= 1;
  await fs.writeFile(file,bytes);
  await assert.rejects(verifyDesktopRelease(root), /SHA512 mismatch/);
});
test('Electron delivery rejects a different update repository', async t => {
  const {root,dir} = await fixture(t);
  await fs.writeFile(path.join(dir,'win-unpacked/resources/app-update.yml'), 'provider: github\nowner: someone\nrepo: VERDANT\n');
  await assert.rejects(verifyDesktopRelease(root), /Wrong installed update provider/);
});
test('Electron delivery requires a blockmap', async t => {
  const {root,dir,name} = await fixture(t);
  await fs.rm(path.join(dir,name+'.blockmap'));
  await assert.rejects(verifyDesktopRelease(root), /ENOENT|Missing blockmap/);
});

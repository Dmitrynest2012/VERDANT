import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { crc32, readZip, flattenSingleFolder } from '../scripts/zip-safe.mjs';
import { archiveInfo, compareVersions, installRelease, readState, cleanupOldArchives } from '../scripts/release-manager.mjs';

/** Минимальный тестовый ZIP (Stored), без сторонних модулей. */
function zipFiles(items) {
  let offset = 0;
  const local = [], central = [];
  for (const [name, value] of Object.entries(items)) {
    const filename = Buffer.from(name);
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const crc = crc32(data);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034B50,0);
    l.writeUInt16LE(20,4);
    l.writeUInt32LE(crc,14);
    l.writeUInt32LE(data.length,18);
    l.writeUInt32LE(data.length,22);
    l.writeUInt16LE(filename.length,26);
    local.push(l,filename,data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014B50,0);
    c.writeUInt16LE(20,4);
    c.writeUInt16LE(20,6);
    c.writeUInt32LE(crc,16);
    c.writeUInt32LE(data.length,20);
    c.writeUInt32LE(data.length,24);
    c.writeUInt16LE(filename.length,28);
    c.writeUInt32LE(offset,42);
    central.push(c,filename);
    offset += l.length + filename.length + data.length;
  }
  const catalog = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50,0);
  end.writeUInt16LE(Object.keys(items).length,8);
  end.writeUInt16LE(Object.keys(items).length,10);
  end.writeUInt32LE(catalog.length,12);
  end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,catalog,end]);
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verdant-check-'));
  await fs.mkdir(path.join(root,'src'), {recursive:true});
  await fs.writeFile(path.join(root,'package.json'), JSON.stringify({name:'verdant-voxel',version:'0.1.0'}));
  await fs.writeFile(path.join(root,'index.html'), '<!doctype html><title>old</title>');
  await fs.writeFile(path.join(root,'src/main.js'),'// old');
  await fs.mkdir(path.join(root,'public/audio'), {recursive:true});
  await fs.writeFile(path.join(root,'public/audio/relax.mp3'), 'мой трек');
  return root;
}

function projectZip(version, extra={}) {
  const prefix = `verdant-voxel-${version}/`;
  return zipFiles({
    [prefix+'package.json']:JSON.stringify({name:'verdant-voxel',version}),
    [prefix+'index.html']:'<!doctype html><title>new</title>',
    [prefix+'src/main.js']:'// updated',
    [prefix+'docs/PROJECT_RULES.md']:'# правила',
    ...extra
  });
}

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z82sAAAAASUVORK5CYII=','base64');

test('Архивы сортируются по версиям; чужой ZIP не считается обновлением', () => {
  assert.equal(compareVersions('0.2.0','0.1.9'),1);
  assert.equal(compareVersions('0.1.1','0.1.1'),0);
  assert.equal(archiveInfo('VERDANT_v0.1.1_PROJECT.zip')?.kind,'PROJECT');
  assert.equal(archiveInfo('VERDANT_v0.1.1_TEXTURES_1K.zip')?.kind,'TEXTURES_1K');
  assert.equal(archiveInfo('my-documents.zip'),null);
});

test('Чтение ZIP: без упаковочной папки и с проверенным CRC', () => {
  const zip = zipFiles({'verdant-voxel-0.1.1/a.txt':'abc','verdant-voxel-0.1.1/b.txt':'def'});
  const entries=flattenSingleFolder(readZip(zip));
  assert.equal(entries.get('a.txt').toString(),'abc');
  assert.equal(entries.get('b.txt').toString(),'def');
});

test('Запрещены Zip Slip, абсолютные пути, симлинки и испорченные ZIP', () => {
  assert.throws(() => readZip(zipFiles({'../evil.txt':'x'})), /путь/i);
  assert.throws(() => readZip(zipFiles({'C:/windows/win.ini':'x'})), /путь/i);
  const zip=zipFiles({'good.txt':'abc'});
  zip[40]=zip[40]^32;
  assert.throws(() => readZip(zip), /CRC32/i);
});

test('Установка ZIP в корень, сохранение своей музыки, правильное состояние релиза', async t => {
  const root=await fixture();
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const proj=path.join(root,'VERDANT_v0.1.1_PROJECT.zip');
  const tex=path.join(root,'VERDANT_v0.1.1_TEXTURES_1K.zip');
  await fs.writeFile(proj,projectZip('0.1.1'));
  await fs.writeFile(tex,zipFiles({'textures/grass_top.png':png}));
  const calls=[];
  const applied=await installRelease({root,projectArchive:proj,textureArchive:tex,
    runChecks:async p=>calls.push(p)});
  assert.equal(applied.version,'0.1.1');
  assert.equal(await fs.readFile(path.join(root,'src/main.js'),'utf8'),'// updated');
  assert.equal(await fs.readFile(path.join(root,'public/audio/relax.mp3'),'utf8'),'мой трек');
  assert.deepEqual(await fs.readFile(path.join(root,'public/textures/grass_top.png')),png);
  assert.equal((await readState(root)).version,'0.1.1');
  assert.equal(calls.length,1);
  assert.ok((await fs.readdir(path.join(root,'.verdant-update/previous'))).includes('manifest.json'));
});

test('Провал npm test/build вызывает откат: старые исходники целы', async t => {
  const root=await fixture();
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const proj=path.join(root,'VERDANT_v0.1.1_PROJECT.zip');
  await fs.writeFile(proj,projectZip('0.1.1'));
  await assert.rejects(installRelease({root,projectArchive:proj,
    runChecks:async()=>{throw new Error('симуляция ошибки сборки');}}),/возвращены/);
  assert.equal(await fs.readFile(path.join(root,'src/main.js'),'utf8'),'// old');
  assert.equal(await fs.readFile(path.join(root,'public/audio/relax.mp3'),'utf8'),'мой трек');
  assert.deepEqual(await readState(root),{});
});

test('Недоверенный ZIP проекта не может перезаписать музыку пользователя', async t => {
  const root=await fixture();
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const proj=path.join(root,'VERDANT_v0.1.1_PROJECT.zip');
  await fs.writeFile(proj,projectZip('0.1.1', {'verdant-voxel-0.1.1/public/audio/relax.mp3':'зло'}));
  await assert.rejects(installRelease({root,projectArchive:proj}), /Недопустимый файл/);
  assert.equal(await fs.readFile(path.join(root,'public/audio/relax.mp3'),'utf8'),'мой трек');
});

test('Удаляются только устаревшие архивы VERDANT, не пользовательские ZIP',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'verdant-downloads-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for (const name of ['VERDANT_v0.1.0_PROJECT.zip','VERDANT_v0.1.1_PROJECT.zip',
     'VERDANT_v0.1.0_TEXTURES_1K.zip','photos.zip']) await fs.writeFile(path.join(root,name),'test');
  assert.equal(await cleanupOldArchives(root,'0.1.1'),2);
  assert.deepEqual((await fs.readdir(root)).sort(),['VERDANT_v0.1.1_PROJECT.zip','photos.zip']);
});

test('При следующем релизе удаляются только устаревшие отслеживаемые файлы', async t => {
  const root=await fixture();
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const zip1=path.join(root,'VERDANT_v0.1.1_PROJECT.zip');
  await fs.writeFile(zip1,projectZip('0.1.1'));
  await installRelease({root,projectArchive:zip1});
  assert.equal((await fs.readFile(path.join(root,'docs/PROJECT_RULES.md'),'utf8')),'# правила');
  const zip2=path.join(root,'VERDANT_v0.1.2_PROJECT.zip');
  const v2=zipFiles({
    'package.json':JSON.stringify({name:'verdant-voxel',version:'0.1.2'}),
    'index.html':'<html>0.1.2</html>',
    'src/main.js':'// new 0.1.2'
  });
  await fs.writeFile(zip2,v2);
  const result=await installRelease({root,projectArchive:zip2});
  assert.equal(result.filesRemoved,1);
  await assert.rejects(fs.access(path.join(root,'docs/PROJECT_RULES.md')),/ENOENT/);
  assert.equal(await fs.readFile(path.join(root,'public/audio/relax.mp3'),'utf8'),'мой трек');
  assert.equal((await readState(root)).version,'0.1.2');
});

test('Обновление только текстур той же версии выполняет проверки и не трогает исходники',async t=>{
  const root=await fixture();
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const zip=path.join(root,'VERDANT_v0.1.0_TEXTURES_1K.zip');
  await fs.writeFile(zip,zipFiles({'README.md':'text','public/textures/grass_top.png':png}));
  let calls=0;
  await installRelease({root,textureArchive:zip,runChecks:async()=>calls++});
  assert.equal(calls,1);
  assert.equal(await fs.readFile(path.join(root,'src/main.js'),'utf8'),'// old');
  assert.equal(await fs.readFile(path.join(root,'public/audio/relax.mp3'),'utf8'),'мой трек');
});

test('После первой ручной распаковки watcher читает проектный манифест без state.json',async t=>{
  const root=await fixture();
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'scripts'), {recursive:true});
  await fs.writeFile(path.join(root,'scripts/release-files.json'),JSON.stringify({
    version:'0.1.0', files:['src/main.js','scripts/release-files.json','public/audio/relax.mp3']
  }));
  assert.deepEqual((await readState(root)).managedProjectFiles,['src/main.js','scripts/release-files.json']);
});


test('После ручной распаковки новой версии проекта texture ZIP ставится, даже если state.json старый',async t=>{
  const root=await fixture();
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const old=path.join(root,'VERDANT_v0.1.10003_PROJECT.zip');
  await fs.writeFile(old,projectZip('0.1.10003'));
  await installRelease({root,projectArchive:old});
  // Пользователь исправил сломанный монитор и вручную распаковал только код.
  await fs.writeFile(path.join(root,'package.json'), JSON.stringify({name:'verdant-voxel',version:'0.1.10004'}));
  const textures=path.join(root,'VERDANT_v0.1.10004_TEXTURES_1K.zip');
  await fs.writeFile(textures,zipFiles({'grass_top.png':png}));
  const result=await installRelease({root,textureArchive:textures});
  assert.equal(result.version,'0.1.10004');
  assert.equal((await readState(root)).version,'0.1.10004');
  assert.deepEqual(await fs.readFile(path.join(root,'public/textures/grass_top.png')),png);
  assert.equal(await fs.readFile(path.join(root,'public/audio/relax.mp3'),'utf8'),'мой трек');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(rel)=>fs.readFile(path.join(ROOT,rel),'utf8');

/** Защита от ситуации: ZIP имеет версию .10004, а игра пишет .10003. */
test('Текущая версия совпадает в package.json, манифесте, UI и документации',async()=>{
  const pkg=JSON.parse(await read('package.json'));
  const manifest=JSON.parse(await read('scripts/release-files.json'));
  const ver=pkg.version;
  assert.equal(manifest.version,ver,'Не совпала версия release-files.json');
  const html=await read('index.html');
  const hud=/ALPHA\s+(\d+\.\d+\.\d+)/.exec(html)?.[1];
  const title=/EARLY BUILD\s*·\s*(\d+\.\d+\.\d+)/.exec(html)?.[1];
  assert.deepEqual([hud,title],[ver,ver],`Неверные версии в HUD / главном меню: ${hud}, ${title}`);
  assert.match(await read('src/main.js'),/VERDANT v\d+\.\d+\.\d+/);
  assert.ok((await read('src/main.js')).includes(`VERDANT v${ver}`),'Не совпала версия в src/main.js');
  assert.ok((await read('README.md')).startsWith(`# VERDANT v${ver}`),'Не совпала версия README');
  assert.match(await read('public/textures/README.md'),new RegExp(`VERDANT v${ver.replaceAll('.','\\.')}`));
  assert.match(await read('CHANGELOG.md'),new RegExp(`^#.*?\\n\\n## ${ver.replaceAll('.','\\.')}`));
});

test('Манифест перечисляет все свои файлы и не включает тяжёлые текстуры/аудио',async()=>{
  const manifest=JSON.parse(await read('scripts/release-files.json'));
  assert.ok(manifest.files.includes('tests/release-consistency.test.mjs'));
  assert.ok(manifest.files.includes('scripts/verify-release.mjs'));
  for(const file of manifest.files){
    assert.doesNotMatch(file,/\.(?:png|jpg|webp|mp3|wav)$/i);
    assert.ok((await fs.stat(path.join(ROOT,file))).isFile(),`В манифесте отсутствующий файл ${file}`);
  }
});

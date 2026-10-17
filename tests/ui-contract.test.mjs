import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI } from '../src/ui/UI.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Все вызовы методов UI из main.js реально реализованы в классе UI',async()=>{
  const code=await fs.readFile(path.join(ROOT,'src/main.js'),'utf8');
  const used=[...code.matchAll(/\bui\.([a-zA-Z]\w*)\s*\(/g)].map(match=>match[1]);
  const methods=new Set(Object.getOwnPropertyNames(UI.prototype));
  assert.ok(used.includes('setGI') && used.includes('setMusic') && used.includes('setMusicStatus'));
  for(const name of used) assert.ok(methods.has(name),`Не реализован метод UI.${name}()`);
});

test('UI.setGI выводит статус WebGPU и не падает при недоступном SSGI',()=>{
  const elements=new Map();
  const status={textContent:''};
  elements.set('gi-status',status);
  const previous=globalThis.document;
  globalThis.document={getElementById:id=>elements.get(id)};
  try{
    const ui=Object.create(UI.prototype);
    ui.giInput={disabled:false,checked:true};
    ui.setGI(false,true);
    assert.equal(ui.giInput.disabled,true);
    assert.equal(ui.giInput.checked,false);
    assert.match(status.textContent,/недоступен/);
    ui.setGI(true,true);
    assert.equal(ui.giInput.disabled,false);
    assert.equal(ui.giInput.checked,true);
    assert.match(status.textContent,/включено/);
    ui.setGI(true,false);
    assert.equal(ui.giInput.checked,false);
  } finally {globalThis.document=previous;}
});

test('UI.setMusic и UI.setMusicStatus работают при отсутствии MP3',()=>{
  const state=new Map();
  const button={textContent:'',setAttribute:(key,value)=>state.set(key,value)};
  const toggles=[];
  const status={textContent:'',classList:{toggle:(a,b)=>toggles.push([a,b])}};
  const previous=globalThis.document;
  globalThis.document={getElementById:id=>id==='music-btn'?button:id==='music-status'?status:null};
  try {
    const ui=Object.create(UI.prototype);
    ui.setMusic(true);
    assert.match(button.textContent,/Выключить/);
    assert.equal(state.get('aria-pressed'),'true');
    ui.setMusicStatus('Трек не найден',true);
    assert.equal(status.textContent,'Трек не найден');
    assert.deepEqual(toggles.pop(),['asset-warning',true]);
    ui.setMusic(false);
    assert.equal(state.get('aria-pressed'),'false');
    assert.match(button.textContent,/Включить/);
  } finally {globalThis.document=previous;}
});

test('npm run dev запускает монитор ZIP, внутренний Vite не рекурсивен',async()=>{
  const pkg=JSON.parse(await fs.readFile(path.join(ROOT,'package.json'),'utf8'));
  assert.equal(pkg.scripts.dev,'node scripts/desktop-dev.mjs');
  assert.equal(pkg.scripts['dev:browser'],'node scripts/dev-entry.mjs');
  assert.equal(pkg.scripts['auto:update'],'node scripts/auto-update.mjs');
  assert.equal(pkg.scripts['dev:server'],'vite --host 127.0.0.1 --strictPort');
  assert.equal(pkg.scripts['update:status'],'node scripts/update-status.mjs');
  const watcher=await fs.readFile(path.join(ROOT,'scripts/auto-update.mjs'),'utf8');
  assert.match(watcher,/npmCommand\(\['run', 'dev:server'\]/);
});

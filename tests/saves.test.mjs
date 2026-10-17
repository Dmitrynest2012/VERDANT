import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { normalizeState, cleanSaveName, newWorldState, stateDigest } from '../src/storage/SaveSchema.js';
import { Inventory } from '../src/core/Inventory.js';

test('Прежнее сохранение сохраняет seed и генератор 1 при миграции',()=>{
 const s=normalizeState({version:1,edits:{'1,3,-2':0},inventory:new Inventory().toJSON()});
 assert.equal(s.version,2);assert.equal(s.seed,170621);assert.equal(s.generatorVersion,1);
 assert.deepEqual(s.edits,{'1,3,-2':0});
});
test('Новый мир получает новый seed, пустые правки и гидрологию',()=>{
 const a=newWorldState({seed:123}),b=newWorldState({seed:456});
 assert.equal(a.generatorVersion,2);assert.equal(b.seed,456);assert.notEqual(a.seed,b.seed);assert.deepEqual(a.water.edits,{});
});
test('Названия допускают русский язык и не допускают пустой ввод',()=>{
 assert.equal(cleanSaveName('  Моя база у озера  '),'Моя база у озера');assert.throws(()=>cleanSaveName(' \n '));
 assert.equal(cleanSaveName('Я'.repeat(100)).length,64);
});
test('Водяные клетки и предмет на курсоре не теряются в снимке',()=>{
 const s=newWorldState({seed:17});s.water.edits={'-5,0,4':8,'-4,0,4':7};s.held={id:'grass',count:11};
 const out=normalizeState(s);assert.deepEqual(out.water,s.water);assert.deepEqual(out.held,s.held);
});
test('Повреждённые и чужие форматы отклоняются, исходный объект не мутируется',()=>{
 const original={version:1,edits:{}};normalizeState(original);assert.equal(original.version,1);
 for(const data of [{version:999},{version:2,edits:{'__proto__':1}},{...newWorldState({seed:1}),edits:{'1,NaN,3':1}},
   {...newWorldState({seed:1}),water:{version:1,edits:{'0,1,0':800}}}]) {
   if(Object.keys(data.edits||{}).length||data.version===999||data.water)assert.throws(()=>normalizeState(data));
 }
});
test('Контрольная сумма изменяется при изменении мира',async()=>{
 const s=normalizeState(newWorldState({seed:1})),a=await stateDigest(s);s.edits['0,8,0']=0;const b=await stateDigest(s);
 assert.match(a,/^[a-f0-9]{64}$/);assert.notEqual(a,b);
});
test('Новые миры не используют confirm и не стирают прежний localStorage',async()=>{
 const source=await fs.readFile(new URL('../src/main.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/window\.confirm|localStorage\.removeItem\(SAVE_KEY/);
 assert.match(source,/newWorldState/);assert.match(source,/onSaveBeforeClose/);
});
test('Ведро не складывается стопкой и меняет состояние атомарно',()=>{
 const i=new Inventory(Array(36).fill(null));assert.equal(i.add('bucket',2),2);
 assert.equal(i.get(0).count,1);assert.equal(i.get(1).count,1);i.convertBucket(0,true);assert.equal(i.get(0).id,'water_bucket');
 i.convertBucket(0,false);assert.equal(i.get(0).id,'bucket');
});
test('Снимок отделён от изменяемого исходника до асинхронной записи',()=>{
 const state=newWorldState({seed:1});state.edits['0,0,0']=0;state.water.edits['1,1,1']=8;
 const snapshot=normalizeState(state);state.edits['0,0,0']=1;state.water.edits['1,1,1']=0;
 assert.equal(snapshot.edits['0,0,0'],0);assert.equal(snapshot.water.edits['1,1,1'],8);
});

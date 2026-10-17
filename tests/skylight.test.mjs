import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleSkylight } from '../src/core/Skylight.js';

function tunnel() {
  const empty=new Set();
  // Горизонтальный тоннель на высоте -20 и шахта к солнечному свету.
  for(let x=0;x<=16;x++)empty.add(`${x},-20,0`);
  for(let y=-20;y<=10;y++)empty.add(`0,${y},0`);
  return {
    hasBlock:(x,y,z)=>y<=10&&!empty.has(`${x},${y},${z}`),
    highestSolid:(x,z)=>x===0&&z===0?-21:10
  };
}

test('Открытое небо яркое, под землёй свет убывает по ходу тоннеля',()=>{
  const world=tunnel(),cache=new Map();
  const open=sampleSkylight(world,0,11,0,cache);
  const entrance=sampleSkylight(world,0,-20,0,cache);
  const near=sampleSkylight(world,3,-20,0,cache);
  const far=sampleSkylight(world,14,-20,0,cache);
  assert.equal(open,1);
  // Прямая открытая шахта светлая даже глубоко, дальше в закрытом тоннеле — спад.
  assert.equal(entrance,1);
  assert.ok(near>0 && near<1);
  assert.equal(far,0);
});

test('На входе в короткий тоннель яркость уменьшается с каждым метром',()=>{
  const empty=new Set();
  for(let x=0;x<=15;x++)empty.add(`${x},3,0`);
  for(let y=3;y<=6;y++)empty.add(`0,${y},0`);
  const w={hasBlock:(x,y,z)=>y<=6&&!empty.has(`${x},${y},${z}`),highestSolid:()=>6};
  const cache=new Map();
  const s0=sampleSkylight(w,0,3,0,cache);
  const s4=sampleSkylight(w,4,3,0,cache);
  const s8=sampleSkylight(w,8,3,0,cache);
  const s14=sampleSkylight(w,14,3,0,cache);
  assert.ok(s0>s4&&s4>s8&&s8>=s14);
  assert.equal(s14,0);
  assert.ok(cache.size>0);
});

test('Внутри твёрдого блока и под закрытым потолком освещение нулевое',()=>{
  const w={hasBlock:(x,y,z)=>y<=0 || (x===0&&y===4&&z===0),highestSolid:(x,z)=>x===0&&z===0?4:0};
  assert.equal(sampleSkylight(w,0,4,0),0);
  // При y>0 и открытом столбце 1 м над дном должен быть дневной свет.
  assert.equal(sampleSkylight(w,1,1,0),1);
});

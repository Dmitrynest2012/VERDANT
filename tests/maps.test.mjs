import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_DIAMETERS, clampMapLevel, mapWorldPosition, sampleMapPixel } from '../src/core/MapSampling.js';
import { terrainHeight, BLOCK } from '../src/core/Terrain.js';

test('Пиксельная карта: четыре разрешённых масштаба',()=>{
 assert.deepEqual(MAP_DIAMETERS,[200,400,800,1600]);
 assert.equal(clampMapLevel(-5),0);
 assert.equal(clampMapLevel(9),3);
 assert.equal(clampMapLevel(1.8),2);
});

test('Центральный пиксель карты соответствует позиции игрока',()=>{
 const p=mapWorldPosition(191.5,191.5,384,20,-10,400);
 assert.equal(p.x,20); assert.equal(p.z,-10);
});

test('Карта отражает разные блоки и высоты',()=>{
 const world={highestSolid:(x,z)=>x>=0?10:5,heightSeed:(x,z)=>terrainHeight(x,z),getBlock:(x,y,z)=>x>=0?BLOCK.GRASS:BLOCK.SHALE};
 const a=sampleMapPixel(world,-4,0); const b=sampleMapPixel(world,4,0);
 assert.notDeepEqual(a,b); assert.equal(a[3],255); assert.equal(b[3],255);
});

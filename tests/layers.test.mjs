import test from 'node:test';
import assert from 'node:assert/strict';
import {
  naturalBlock, terrainHeight, rockStartDepth, compactStartDepth, shaleStartDepth, deepStoneStartDepth,
  MIN_WORLD_Y, MAX_WORLD_Y, BLOCK, sectionKey, SECTION_HEIGHT, BLOCK_ITEM_BY_TYPE
} from '../src/core/Terrain.js';

test('Слои мира: трава, земля, каменистая земля, плотная земля, сланец и глубинная порода',()=>{
  for(let x=-25;x<=25;x+=5)for(let z=-25;z<=25;z+=5){
    const top=terrainHeight(x,z);
    const rock=rockStartDepth(x,z);
    const compact=compactStartDepth(x,z);
    const shale=shaleStartDepth(x,z);
    const deep=deepStoneStartDepth(x,z);
    assert.ok(rock>=4&&rock<=7);
    assert.ok(compact>rock);
    assert.ok(shale>compact);
    assert.ok(deep>shale);
    assert.equal(naturalBlock(x,top,z),BLOCK.GRASS);
    assert.equal(naturalBlock(x,top-1,z),BLOCK.DIRT);
    assert.equal(naturalBlock(x,top-rock,z),BLOCK.ROCKY_DIRT);
    assert.equal(naturalBlock(x,top-compact,z),BLOCK.COMPACT_EARTH);
    assert.equal(naturalBlock(x,top-shale,z),BLOCK.SHALE);
    const deepY=Math.max(MIN_WORLD_Y, top-deep);
    assert.equal(naturalBlock(x,deepY,z),BLOCK.DEEP_STONE);
    assert.equal(naturalBlock(x,top+1,z),BLOCK.AIR);
  }
});

test('Подземные координаты −1000 и высоты +50 допустимы, контур по Y строгий',()=>{
  assert.equal(MIN_WORLD_Y,-1000);
  assert.equal(MAX_WORLD_Y,50);
  assert.notEqual(naturalBlock(0,-1000,0),BLOCK.AIR);
  assert.equal(naturalBlock(0,-1001,0),BLOCK.AIR);
  assert.equal(naturalBlock(0,51,0),BLOCK.AIR);
});

test('Секции 16 м корректно адресуют отрицательные координаты',()=>{
  assert.equal(Math.floor(-1/SECTION_HEIGHT),-1);
  assert.equal(Math.floor(-1000/SECTION_HEIGHT),-63);
  assert.equal(sectionKey(-1,-63,2),'-1,-63,2');
  assert.equal(BLOCK_ITEM_BY_TYPE[1],'grass');
  assert.equal(BLOCK_ITEM_BY_TYPE[2],'dirt');
  assert.equal(BLOCK_ITEM_BY_TYPE[3],'rocky_dirt');
  assert.equal(BLOCK_ITEM_BY_TYPE[4],'compact_earth');
  assert.equal(BLOCK_ITEM_BY_TYPE[5],'shale');
  assert.equal(BLOCK_ITEM_BY_TYPE[6],'deep_stone');
});

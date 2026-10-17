import test from 'node:test';
import assert from 'node:assert/strict';
import { terrainHeight, insideHorizontal, WORLD_HALF, MAX_WORLD_Y, MIN_WORLD_Y, MIN_CHUNK, MAX_CHUNK, CHUNK_SIZE, blockKey } from '../src/core/Terrain.js';

test('Мир не меньше 2×2 км по горизонтали', () => {
  assert.equal(WORLD_HALF, 1000);
  assert.equal(insideHorizontal(-1000,-1000), true);
  assert.equal(insideHorizontal(999,999), true);
  assert.equal(insideHorizontal(1000,999), false);
  assert.equal(insideHorizontal(-1001,0), false);
});

test('Поляна спавна ровная и высота достаточно безопасна', () => {
  for (let x = -4; x <= 4; x++) {
    for (let z = -4; z <= 4; z++) {
      assert.equal(terrainHeight(x,z), 8);
    }
  }
});

test('Высота детерминирована и помещается в лимиты мира', () => {
  for (let x = -40; x < 40; x += 3) {
    for (let z = -40; z < 40; z += 3) {
      const h = terrainHeight(x,z);
      assert.equal(h, terrainHeight(x,z));
      assert.ok(h >= MIN_WORLD_Y + 8 && h < MAX_WORLD_Y);
    }
  }
  assert.equal(blockKey(1,2,3), '1,2,3');
});


test('Чанки целочисленные и покрывают весь мир, включая крайние границы', () => {
  assert.equal(MIN_CHUNK, -63);
  assert.equal(MAX_CHUNK, 62);
  const covered = new Set();
  for (let cx=MIN_CHUNK; cx<=MAX_CHUNK; cx++) {
    for (let x=cx*CHUNK_SIZE; x<(cx+1)*CHUNK_SIZE; x++) {
      if (x >= -WORLD_HALF && x < WORLD_HALF) covered.add(x);
    }
  }
  assert.equal(covered.size, WORLD_HALF*2);
  assert.ok(covered.has(-1000) && covered.has(999));
});

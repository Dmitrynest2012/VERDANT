import test from 'node:test';
import assert from 'node:assert/strict';
import {planTerrain,nearDetailRadius,farTileStep,distanceToTile} from '../src/core/StreamPlanner.js';
import {WORLD_HALF,CHUNK_SIZE,insideHorizontal,terrainHeight,orientedUV,grassTintAt,textureOrientation} from '../src/core/Terrain.js';

test('2×2 км: края включены, а за пределами мира нет твёрдых блоков',()=>{
  assert.equal(WORLD_HALF,1000);
  for(const x of [-1000,-999,0,998,999])for(const z of [-1000,0,999]){
    assert.equal(insideHorizontal(x,z),true);
    assert.ok(terrainHeight(x,z)>-50);
  }
  assert.equal(insideHorizontal(1000,0),false);
  assert.equal(insideHorizontal(-1001,0),false);
});

test('1 км не порождает десятки тысяч ближних 16³ мешей',()=>{
  const plan=planTerrain(0,0,1000);
  assert.ok(plan.near.length<250,`ближних: ${plan.near.length}`);
  assert.ok(plan.far.length<350,`дальних: ${plan.far.length}`);
  assert.equal(plan.radius,112);
  for(const n of plan.near){
    assert.ok(n.cx*CHUNK_SIZE < WORLD_HALF);
    assert.ok(n.cz*CHUNK_SIZE < WORLD_HALF);
  }
});

test('На границах карты LOD не запрашивает внешние тайлы',()=>{
  for(const p of [-999,999]){
    const plan=planTerrain(p,p,1000);
    assert.ok(plan.near.length>0);
    assert.ok(plan.far.length>0);
    for(const tile of plan.far){
      assert.ok(tile.tx*128<WORLD_HALF && (tile.tx+1)*128>-WORLD_HALF);
      assert.ok(tile.tz*128<WORLD_HALF && (tile.tz+1)*128>-WORLD_HALF);
    }
  }
});

test('Дальние сетки становятся реже, радиус полного воксельного мира ограничен',()=>{
  assert.equal(nearDetailRadius(200),92);
  assert.equal(nearDetailRadius(1000),112);
  assert.equal(farTileStep(100),4);
  assert.equal(farTileStep(350),8);
  assert.equal(farTileStep(800),16);
  assert.equal(distanceToTile(1,1,0,0),0);
  assert.ok(distanceToTile(0,0,3,0)>200);
});

test('UV-трансформации сохраняют единичный квадрат и воспроизводимы',()=>{
  const transforms=new Set();
  for(let i=0;i<8;i++){
    const uv=orientedUV(.15,.62,i);
    assert.ok(uv.every(v=>v>=0&&v<=1));
    transforms.add(uv.join(','));
  }
  assert.equal(transforms.size,8);
  assert.equal(textureOrientation(3,11,-42),textureOrientation(3,11,-42));
});

test('Мозаичность травы: непрерывный макро-градиент вместо резких случайных клеток',()=>{
  const a=grassTintAt(100,200),b=grassTintAt(100.01,200.01);
  assert.ok(Math.abs(a.g-b.g)<.015);
  assert.ok(Math.abs(a.r-b.r)<.015);
  assert.notDeepEqual(grassTintAt(11,22),grassTintAt(333,22));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { FluidWorld, WATER, fluidHeight } from '../src/core/FluidWorld.js';
import { SurfaceHydrology } from '../src/core/SurfaceHydrology.js';
import { buildWaterSection } from '../src/core/WaterGeometry.js';
import { terrainHeight } from '../src/core/Terrain.js';
import { swimDirection, stepSwimming } from '../src/core/SwimPhysics.js';
function fixture(floor=0) {
  const blocks=new Map();
  const world={surfaceColumn:()=>({height:floor,waterY:null}),hasBlock:(x,y,z)=>blocks.has(`${x},${y},${z}`)?blocks.get(`${x},${y},${z}`):y<=floor};
  world.water=new FluidWorld(world);return {world,water:world.water,blocks};
}
const settle=(water,n=35,center={x:0,y:1,z:0})=>{for(let i=0;i<n;i++)water.tick(center,40000,1000);};
test('Источник растекается на 7 клеток, но не на 8 и не сквозь пол',()=>{
 const {water}=fixture();water.setSource(0,1,0);settle(water);
 assert.equal(water.get(0,1,0),8);assert.equal(water.get(1,1,0),7);assert.equal(water.get(7,1,0),1);
 assert.equal(water.get(8,1,0),0);assert.equal(water.get(0,0,0),0);assert.equal(water.get(0,2,0),0);
});
test('Без источника связанный поток постепенно исчезает',()=>{
 const {water}=fixture();water.setSource(0,1,0);settle(water);assert.ok(water.takeSource(0,1,0));settle(water,80);
 for(let x=-8;x<=8;x++)for(let z=-8;z<=8;z++)assert.equal(water.get(x,1,z),0);
});
test('При падении вода идёт вниз, не создавая горизонтальную стену в воздухе',()=>{
 const {water}=fixture(-5);water.setSource(0,3,0);settle(water,35,{x:0,y:0,z:0});
 assert.equal(water.get(0,2,0),WATER.FALLING);assert.equal(water.get(1,2,0),0);
 assert.ok(water.get(1,-4,0));assert.equal(water.get(0,-5,0),0);
});
test('Два соседних источника создают новый только при наличии опоры',()=>{
 const {water,blocks}=fixture();water.setSource(0,1,0);water.setSource(2,1,0);settle(water,5);assert.equal(water.get(1,1,0),8);
 const f=fixture(-10);f.water.setSource(0,1,0);f.water.setSource(2,1,0);settle(f.water,5);assert.notEqual(f.water.get(1,1,0),8);
 blocks.set('1,1,0',true);water.solidChanged(1,1,0);assert.equal(water.get(1,1,0),0);
});
test('Сохранение жидкости восстанавливает источники, удалённые источники и поток',()=>{
 const a=fixture();a.water.setSource(0,1,0);settle(a.water,12);
 const b=fixture();b.world.water=new FluidWorld(b.world,a.water.toJSON());
 assert.deepEqual(b.world.water.toJSON(),a.water.toJSON());assert.equal(b.world.water.get(3,1,0),a.water.get(3,1,0));
});
test('Генератор 1 не меняет старый ландшафт и не затапливает постройки',()=>{
 const h=new SurfaceHydrology(170621,1);
 for(let x=-80;x<80;x+=5)for(let z=-80;z<80;z+=5){const c=h.column(x,z);assert.equal(c.height,terrainHeight(x,z,170621));assert.equal(c.waterY,null);}
});
test('Новые водоёмы ограничены поверхностными чашами, старт сухой',()=>{
 const hydro=new SurfaceHydrology(170621,2);assert.equal(hydro.column(0,0).waterY,null);
 let wet=0,depthMax=0;
 for(let x=10;x<90;x++)for(let z=-70;z<5;z++) {
  const c=hydro.column(x,z);
  if(c.waterY!==null){wet++;assert.ok(c.height<c.waterY);depthMax=Math.max(depthMax,c.waterY-c.height);assert.ok(c.height>-20);
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const n=hydro.column(x+dx,z+dz);if(n.waterY===null)assert.ok(n.height>=c.waterY);}}
 }
 assert.ok(wet>300);assert.ok(depthMax>=4&&depthMax<=10);
 assert.deepEqual(hydro.column(48,-32),new SurfaceHydrology(170621,2).column(48,-32));
});
test('Геометрия воды не содержит NaN и выходящих за буфер индексов',()=>{
 const {world,water}=fixture();water.setSource(0,1,0);settle(water,10);
 const mesh=buildWaterSection(world,0,0,0);assert.ok(mesh.index.length>0);
 for(const list of Object.values(mesh))assert.ok(list.every(Number.isFinite));
 assert.equal(mesh.waterInfo.length,mesh.position.length);assert.ok(Math.max(...mesh.index)<mesh.position.length/3);assert.equal(fluidHeight(8),8/9);
});
test('Управление плаванием — 3 оси без диагонального ускорения',()=>{
 assert.deepEqual(swimDirection(0,0,1,0,0),{x:0,y:0,z:-1});
 const down=swimDirection(0,-Math.PI/2,1,0,0);assert.ok(down.y<-.99);
 const d=swimDirection(.7,.2,1,1,1);assert.ok(Math.hypot(d.x,d.y,d.z)<=1.00001);
});
test('Пловец не проходит сквозь стену и потолок',()=>{
 const {world,water,blocks}=fixture(-10);
 for(let z=-3;z<4;z++)for(let y=-2;y<4;y++)blocks.set(`1,${y},${z}`,true);
 const body={position:{x:0,y:0,z:0},velocity:{x:0,y:0,z:0},height:1.78,yaw:0,pitch:0};
 for(let i=0;i<240;i++)stepSwimming(body,world,water,1/120,new Set(['KeyD']));
 assert.ok(body.position.x<.711);assert.ok(body.position.x>.65);
});

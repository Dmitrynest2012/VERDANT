import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import {buildWaterSection,waterCorner} from '../src/core/WaterGeometry.js';
import {VoxelWorld} from '../src/core/VoxelWorld.js';
import {flareLayout,sunScreenVisibility,FLARE_OPACITIES} from '../src/core/SunOptics.js';
import {makeGrassMaterial} from '../src/gfx/GrassMaterial.js';

function lakeFixture(top=4,vary=false){
 const floor=(x,z)=>vary?(Math.floor(x/3)%3):0;
 const wall=(x,z)=>x<0||z<0||x>=32||z>=32;
 return {surfaceColumn(x,z){return {height:floor(x,z),waterY:top};},
  hasBlock(x,y,z){return y<=floor(x,z)||wall(x,z);},
  water:{byColumn:new Map(),get(x,y,z){return !wall(x,z)&&y>floor(x,z)&&y<=top?8:0;}}};
}
test('Озеро не содержит внутренних стенок между водяными кубами',()=>{
 const g=buildWaterSection(lakeFixture(),0,0,0);
 assert.equal(g.index.length,16*16*6);
 for(let i=0;i<g.normal.length;i+=3)assert.deepEqual(g.normal.slice(i,i+3),[0,1,0]);
});
test('Полностью подводная секция не рисует ни одной внутренней грани',()=>{
 const g=buildWaterSection(lakeFixture(20),0,0,0);assert.equal(g.index.length,0);
});
test('Вода на границе секций имеет общие высоту, глубину и береговую маску',()=>{
 const w=lakeFixture(4,true),a=buildWaterSection(w,0,0,0),b=buildWaterSection(w,1,0,0);
 const pick=g=>{const map=new Map();for(let i=0;i<g.position.length/3;i++)if(g.position[i*3]===16){const p=g.position.slice(i*3,i*3+3);map.set(p.join(','),g.waterInfo.slice(i*3,i*3+3));}return map;};
 const left=pick(a),right=pick(b);assert.ok(left.size>8);
 for(const [key,value]of left)assert.deepEqual(value,right.get(key),key);
 const c=waterCorner(w,16,4,3);assert.ok(Number.isFinite(c.depth)&&c.depth>0);
});
test('Три блика при взгляде прямо на солнце разделены и увеличиваются к углу',()=>{
 for(const [w,h]of [[960,640],[1920,1080],[2560,1440]]){
  const f=flareLayout(w/2,h/2,w,h,1);assert.equal(f.length,3);
  for(let i=0;i<3;i++){assert.ok(f[i].opacity>0&&f[i].opacity<.2);if(i){assert.ok(f[i].x>f[i-1].x&&f[i].y>f[i-1].y);assert.ok(f[i].diameter>f[i-1].diameter);}}
 }
 assert.equal(flareLayout(NaN,0,100,100).length,0);
});
test('Солнечная оптика плавно пропадает за экраном и позади камеры',()=>{
 assert.equal(sunScreenVisibility(0,0,1),1);assert.equal(sunScreenVisibility(0,0,-1),0);assert.equal(sunScreenVisibility(1.2,0,1),0);
 assert.ok(sunScreenVisibility(.95,0,1)>0&&sunScreenVisibility(.95,0,1)<1);
 assert.deepEqual(flareLayout(100,100,900,600,0).map(f=>f.opacity),[0,0,0]);assert.equal(FLARE_OPACITIES.length,3);
});
test('Трава использует общий Node-материал, старые карты и сохраняет normalStrength',()=>{
 const map=new THREE.Texture(),normalMap=new THREE.Texture();
 const src=new THREE.MeshStandardMaterial({map,normalMap,vertexColors:true});
 const m=makeGrassMaterial(src);assert.ok(m.isNodeMaterial&&m.colorNode&&m.normalNode);
 assert.equal(m.map,map);assert.equal(m.normalMap,normalMap);assert.equal(m.vertexColors,true);
 m.normalScale.set(2,2);assert.equal(m.normalScale.x,2);
 const clone=m.clone();assert.equal(clone.colorNode,m.colorNode);assert.equal(clone.normalNode,m.normalNode);
});
test('Дальний LOD не оставляет юбки у игрока и имеет конечный ненулевой TBN',()=>{
 const scene=new THREE.Scene(),materials=Array.from({length:7},()=>new THREE.MeshStandardMaterial());
 const w=new VoxelWorld(scene,materials,null,170621,{generatorVersion:1});w.streamOrigin={x:35.9,y:7,z:-4};w.nearRadius=92;
 w.buildFarTile(0,-1,4);
 const g=w.lodTiles.get('0,-1').mesh.geometry,normal=g.attributes.normal,tangent=g.attributes.tangent,p=g.attributes.position;
 assert.ok(g.index.count>0);
 for(let i=0;i<p.count;i++){
  for(const a of Object.values(g.attributes))for(let k=0;k<a.itemSize;k++)assert.ok(Number.isFinite(a.array[i*a.itemSize+k]));
  assert.ok(Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i))>.99);
  assert.ok(Math.hypot(tangent.getX(i),tangent.getY(i),tangent.getZ(i))>.99);
  assert.ok(Math.hypot(p.getX(i)-35.9,p.getZ(i)+4)>88,'Юбка LOD проникла в ближнюю зону');
 }
 for(const id of g.index.array)assert.ok(id>=0&&id<p.count);
});
test('Конкретный треугольник у z=0 не перекрывает близкий грунт',()=>{
 const scene=new THREE.Scene(),m=Array.from({length:7},()=>new THREE.MeshStandardMaterial());
 const w=new VoxelWorld(scene,m,null,170621,{generatorVersion:1});w.streamOrigin={x:35.9,y:7,z:-4};w.nearRadius=92;
 w.buildFarTile(0,-1,4);w.buildFarTile(0,0,4);scene.updateMatrixWorld(true);
 const camera=new THREE.PerspectiveCamera(78,1100/720,.08,2600);camera.position.set(35.9,8.62,-4);camera.rotation.order='YXZ';camera.rotation.y=2.4;camera.rotation.x=-.12;camera.updateMatrixWorld(true);
 const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(350/1100*2-1,1-476/720*2),camera);ray.far=12;
 assert.equal(ray.intersectObjects(scene.children).length,0);
});

import {launchQA} from './qa-launch.mjs';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
/** Реальные изображения TSL через явно указанный программный WebGL2.
 * TEST-инъекции не входят в исходный src/main.js и не меняют WebGPU приложения. */
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5198','--strictPort'],{stdio:'ignore'});
const base='http://127.0.0.1:5198';let browser,page;const errors=[],report={backend:'software WebGL2',hardwareFPS:false};
await fs.mkdir('qa-results',{recursive:true});
try{
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 browser=await launchQA();report.browser=browser.version();page=await browser.newPage({viewport:{width:1100,height:720}});
 page.on('pageerror',e=>{errors.push(e.message);console.log('ERROR',e.message);});
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('ERROR',m.text().slice(0,1200));}});
 await page.route('**/src/main.js',async route=>{
  const response=await route.fetch();let s=await response.text();
  assert.ok(s.includes('renderer.setAnimationLoop(tick);'));
  s=s.replace('renderer.setAnimationLoop(tick);','globalThis.__q={world,renderer,player,camera,env,clouds,lighting,waterRenderer,terrainMaterials,scene,THREE};');
  s=s.replace('new THREE.WebGPURenderer({','new THREE.WebGPURenderer({forceWebGL:true,');
  await route.fulfill({response,body:s});
 });
 await page.addInitScript(()=>{
  if(!localStorage.getItem('qa-fixture')){
   localStorage.setItem('qa-fixture','1');
   localStorage.setItem('verdant-world-v1',JSON.stringify({version:1,edits:{},player:{position:{x:35.9,y:7,z:-4},yaw:-.75,pitch:-.12},musicEnabled:false,graphicsSchema:2,
    graphics:{preset:'custom',resolution:1,ssgi:false,shadows:'medium',viewDistance:200,fog:50,normalStrength:1.4,exposure:1.05,fov:78,cloudSpeed:1,waterQuality:'high'}}));
  }
 });
 async function ready(){
  await page.waitForFunction(()=>!!globalThis.__q||!document.querySelector('#fatal-screen').classList.contains('hidden'),{},{timeout:60000});
  if(!await page.evaluate(()=>!!globalThis.__q))throw Error(await page.locator('#fatal-detail').textContent());
  await page.evaluate(()=>{document.querySelectorAll('.overlay').forEach(x=>x.classList.add('hidden'));document.body.classList.add('playing');document.querySelector('#hud').style.display='block';const q=__q;q.lighting.setEnabled(false);while(q.world.streamQueue.length)q.world.processStreaming(100,100);q.camera.updateMatrixWorld(true);});
 }
 async function render(water=false){
  await page.evaluate(w=>{const q=__q;for(let i=0;i<4;i++){q.camera.updateMatrixWorld(true);q.env.update(.2,1);q.clouds.update(.2);if(w)q.waterRenderer.environment(q.env,.2,q.player);q.lighting.render();}},water);
 }
 await page.goto(base,{waitUntil:'domcontentloaded'});await ready();
 assert.equal(await page.evaluate(()=>__q.terrainMaterials[0].isNodeMaterial),true);
 await render();await page.screenshot({path:'qa-results/grass-after.png'});
 await page.evaluate(()=>{__q.camera.rotation.y=2.4;});await render();
 report.wedge=await page.evaluate(()=>{
  const q=__q,r=new q.THREE.Raycaster();q.scene.updateMatrixWorld(true);r.setFromCamera(new q.THREE.Vector2(350/1100*2-1,1-476/720*2),q.camera);r.far=12;
  const hit=r.intersectObjects(q.scene.children).find(h=>h.object.name.startsWith('section')||h.object.name.startsWith('far-lod'));
  return {mesh:hit?.object.name,point:hit?.point.toArray()};
 });
 assert.match(report.wedge.mesh,/^section/);await page.screenshot({path:'qa-results/triangle-after.png'});
 await page.evaluate(()=>{const q=__q;q.camera.lookAt(q.camera.position.clone().add(q.env.direction));});
 await render();
 report.flares=await page.evaluate(()=>[...document.querySelectorAll('.sun-flare')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,opacity:Number(s.opacity),visibility:s.visibility,display:s.display};}));
 assert.equal(report.flares.length,3);
 report.flares.forEach((f,i)=>{assert.ok(f.opacity>.035&&f.opacity<.2);assert.equal(f.visibility,'visible');assert.notEqual(f.display,'none');if(i){assert.ok(f.x>report.flares[i-1].x&&f.width>report.flares[i-1].width);}});
 await page.screenshot({path:'qa-results/sun-flares-after.png'});
 report.cloud=await page.evaluate(()=>{
  const c=__q.clouds.texture.image,d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let max=0,body=0;
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const a=d[(y*c.width+x)*4+3];body=Math.max(body,a);if(x<4||y<4||x>=c.width-4||y>=c.height-4)max=Math.max(max,a);}
  return{maxEdgeAlpha:max,maxBodyAlpha:body,image:c.toDataURL()};
 });
 assert.equal(report.cloud.maxEdgeAlpha,0);assert.ok(report.cloud.maxBodyAlpha>200);
 await fs.writeFile('qa-results/cloud-alpha-after.png',Buffer.from(report.cloud.image.split(',')[1],'base64'));delete report.cloud.image;
 report.occlusion=await page.evaluate(()=>{
  const q=__q,p=q.camera.position.clone().addScaledVector(q.env.direction,3),x=Math.floor(p.x),y=Math.floor(p.y),z=Math.floor(p.z),old=q.world.getBlock(x,y,z);
  q.world.setBlock(x,y,z,2);q.env.update(.2,1);
  const hidden=[...document.querySelectorAll('.sun-flare')].every(e=>e.style.display==='none')&&!q.env.disc.visible;
  q.world.setBlock(x,y,z,old);return hidden;
 });assert.equal(report.occlusion,true);
 await page.evaluate(async()=>{
  const {SaveRepository}=await import('/src/storage/SaveRepository.js'),{newWorldState}=await import('/src/storage/SaveSchema.js'),{SurfaceHydrology}=await import('/src/core/SurfaceHydrology.js');
  const r=await new SaveRepository().open(),current=await r.load(await r.active()),s=newWorldState({seed:170621,graphics:current.state.graphics,musicEnabled:false});
  const c=new SurfaceHydrology(170621,2).column(48,-32);s.player={position:{x:48.5,y:c.waterY+3,z:-31.5},yaw:0,pitch:-.65};
  await r.create('Render QA lake',s);r.close();
 });
 await page.reload({waitUntil:'domcontentloaded'});await ready();
 await page.evaluate(()=>{const q=__q;q.waterRenderer.update(0,q.player,200);let n=0;while(q.waterRenderer.jobs.length&&n++<1000)q.waterRenderer.update(0,q.player,200);});
 await render(true);await page.screenshot({path:'qa-results/water-surface-after.png'});
 await page.evaluate(()=>{const q=__q,c=q.world.surfaceColumn(48,-32);q.camera.position.set(48.5,c.waterY-1,-31.5);q.camera.rotation.x=-.12;});
 await render(true);assert.equal(await page.evaluate(()=>document.body.classList.contains('underwater')),true);
 await page.screenshot({path:'qa-results/underwater-after.png'});
 report.underwaterFlares=await page.evaluate(()=>getComputedStyle(document.querySelector('#sun-fx')).visibility==='hidden');assert.equal(report.underwaterFlares,true);
 report.waterMeshes=await page.evaluate(()=>__q.waterRenderer.meshes.size);assert.ok(report.waterMeshes>0);
 if(errors.length)throw Error(errors.join('\n'));
 report.passed=true;console.log('RENDER REGRESSIONS PASS',JSON.stringify(report));
}finally{
 report.errors=errors;await page?.screenshot({path:'qa-results/last-frame.png'}).catch(()=>{});
 await fs.writeFile('qa-results/report.json',JSON.stringify(report,null,2));await browser?.close();server.kill();
}

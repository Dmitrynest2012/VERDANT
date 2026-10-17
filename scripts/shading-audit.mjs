import {launchQA} from './qa-launch.mjs';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5199','--strictPort'],{stdio:'ignore'});let browser;
await fs.mkdir('qa-results',{recursive:true});
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:5199')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 browser=await launchQA();
 for(const mode of ['normal','no-shadow','no-normal-map','bright-ambient','unlit']){
  const page=await browser.newPage({viewport:{width:1100,height:720}});
  page.on('pageerror',e=>console.log('ERROR',e.message));
  await page.route('**/src/main.js',async route=>{const r=await route.fetch();let s=await r.text();s=s.replace('renderer.setAnimationLoop(tick);','globalThis.__q={world,renderer,player,camera,env,clouds,lighting,waterRenderer,terrainMaterials,scene,THREE};').replace('new THREE.WebGPURenderer({','new THREE.WebGPURenderer({forceWebGL:true,');await route.fulfill({response:r,body:s});});
  await page.addInitScript(()=>localStorage.setItem('verdant-world-v1',JSON.stringify({version:1,edits:{},player:{position:{x:35.9,y:7,z:-4},yaw:-.75,pitch:-.12},musicEnabled:false,graphicsSchema:2,graphics:{preset:'custom',resolution:1,ssgi:false,shadows:'medium',viewDistance:200}})));
  await page.goto('http://127.0.0.1:5199');await page.waitForFunction(()=>!!globalThis.__q);
  await page.evaluate(mode=>{
   const q=__q;document.querySelectorAll('.overlay').forEach(x=>x.classList.add('hidden'));q.lighting.setEnabled(false);q.clouds.setQuality('off');
   while(q.world.streamQueue.length)q.world.processStreaming(100,100);
   if(mode==='no-shadow'){q.renderer.shadowMap.enabled=false;q.env.sun.castShadow=false;q.scene.traverse(o=>{o.castShadow=false;o.receiveShadow=false;});}
   if(mode==='no-normal-map')q.terrainMaterials.forEach(m=>{m.normalMap=null;m.normalNode=null;});
   if(mode==='bright-ambient'){q.env.ambient.intensity=2;q.env.hemisphere.intensity=1;}
   if(mode==='unlit')q.scene.overrideMaterial=new q.THREE.MeshBasicMaterial({color:'#999999',vertexColors:true});
   q.terrainMaterials.forEach(m=>m.needsUpdate=true);q.world.lodMaterial.needsUpdate=true;
   q.camera.updateMatrixWorld(true);q.env.update(.2,1);q.lighting.render();
  },mode);
  await page.screenshot({path:`qa-results/shading-${mode}.png`});
  await page.evaluate(()=>{__q.camera.rotation.y=2.4;__q.camera.updateMatrixWorld(true);__q.env.update(.2,1);__q.lighting.render();});
  await page.screenshot({path:`qa-results/reverse-${mode}.png`});await page.close();console.log('CAPTURED',mode);
 }
}finally{await browser?.close();server.kill();}

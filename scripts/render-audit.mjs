import {launchQA} from './qa-launch.mjs';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5198','--strictPort'],{stdio:'ignore'});
const base='http://127.0.0.1:5198';let browser,page;const errors=[];
await fs.mkdir('qa-results',{recursive:true});
try {
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 browser=await launchQA();console.log('BROWSER',browser.version());
 page=await browser.newPage({viewport:{width:1100,height:720}});
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});
 page.on('console',m=>{if(['error','warning'].includes(m.type()))console.log('BROWSER',m.text().slice(0,1000));if(m.type()==='error')errors.push(m.text().slice(0,1000));});
 await page.route('**/src/main.js',async route=>{
  const response=await route.fetch();let s=await response.text();const target='renderer.setAnimationLoop(tick);';
  if(!s.includes(target))throw Error('Cannot install QA handle');
  s=s.replace(target,'globalThis.__renderQA={world,renderer,player,camera,env,clouds,lighting,waterRenderer,terrainMaterials,tick};');
  s=s.replace('new THREE.WebGPURenderer({','new THREE.WebGPURenderer({forceWebGL:true,');
  await route.fulfill({response,body:s});
 });
 await page.addInitScript(()=>localStorage.setItem('verdant-world-v1',JSON.stringify({version:1,edits:{},player:{position:{x:35.9,y:7,z:-4},yaw:-.75,pitch:-.12},musicEnabled:false,graphicsSchema:2,graphics:{preset:'custom',shadows:'medium',clouds:'high',resolution:1,viewDistance:200,fog:50,normalStrength:1.4,exposure:1.05,fov:78,cloudSpeed:1,ssgi:false,waterQuality:'high'}})));
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!!globalThis.__renderQA||!document.querySelector('#fatal-screen').classList.contains('hidden'),{},{timeout:60000});
 if(!await page.evaluate(()=>!!globalThis.__renderQA))throw Error(await page.locator('#fatal-detail').textContent());
 await page.evaluate(()=>{document.querySelectorAll('.overlay').forEach(x=>x.classList.add('hidden'));document.body.classList.add('playing');document.querySelector('#hud').style.display='block';const q=__renderQA;while(q.world.streamQueue.length)q.world.processStreaming(100,100);q.camera.updateMatrixWorld(true);});
 async function shot(name,opts){
  const data=await page.evaluate(async o=>{const q=__renderQA;q.env.setShadows(o.shadows);q.lighting.setEnabled(false);if(o.sun)q.camera.lookAt(q.camera.position.clone().add(q.env.direction));for(let i=0;i<3;i++){q.camera.updateMatrixWorld(true);q.env.update(.2,1);q.clouds.update(.2);q.lighting.render();}return {gpu:q.renderer.backend.isWebGPUBackend===true,stats:q.world.getStreamStats()};},opts);
  await page.screenshot({path:`qa-results/${name}.png`});console.log(name,JSON.stringify(data));
 }
 await shot('terrain-shadow-no-gi',{shadows:'medium'});
 await shot('terrain-no-shadow-no-gi',{shadows:'off'});
 await page.evaluate(()=>{__renderQA.world.lodTiles.forEach(t=>t.mesh.visible=false);});
 await shot('terrain-no-lod',{shadows:'medium'});
 await shot('sun-clouds-flares',{shadows:'medium',sun:true});
 const cloud=await page.evaluate(()=>{const c=__renderQA.clouds.texture.image,ctx=c.getContext('2d'),d=ctx.getImageData(0,0,c.width,c.height).data;let max=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(x<4||y<4||x>=c.width-4||y>=c.height-4)max=Math.max(max,d[(y*c.width+x)*4+3]);return {max,data:c.toDataURL()};});
 await fs.writeFile('qa-results/cloud-alpha.png',Buffer.from(cloud.data.split(',')[1],'base64'));console.log('CLOUD EDGE ALPHA',cloud.max);
}finally{await page?.screenshot({path:'qa-results/last-frame.png'}).catch(()=>{});await fs.writeFile('qa-results/errors.json',JSON.stringify(errors,null,2));await browser?.close();server.kill();}

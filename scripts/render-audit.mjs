import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5198','--strictPort'],{stdio:'pipe'});
server.stdout.on('data',()=>{});server.stderr.on('data',b=>console.log(String(b).slice(0,500)));
const base='http://127.0.0.1:5198';let browser;const errors=[];
await fs.mkdir('qa-results',{recursive:true});
try {
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 browser=await chromium.launch({channel:'chrome',headless:false,args:['--no-sandbox','--enable-unsafe-webgpu','--use-webgpu-adapter=swiftshader','--use-angle=vulkan','--use-vulkan=swiftshader','--enable-features=Vulkan','--disable-vulkan-surface','--enable-dawn-features=allow_unsafe_apis']});
 console.log('BROWSER',browser.version());
 const page=await browser.newPage({viewport:{width:960,height:640}});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,1000));});
 await page.route('**/src/main.js',async route=>{
  const response=await route.fetch();let s=await response.text();
  const target='renderer.setAnimationLoop(tick);';
  if(!s.includes(target))throw Error('Cannot install QA handle into main');
  s=s.replace(target,'globalThis.__renderQA={world,renderer,player,camera,env,clouds,lighting,waterRenderer,terrainMaterials,tick};');
  await route.fulfill({response,body:s});
 });
 await page.addInitScript(()=>localStorage.setItem('verdant-world-v1',JSON.stringify({version:1,edits:{},player:{position:{x:35.9,y:7,z:-4},yaw:-.75,pitch:-.12},musicEnabled:false,graphicsSchema:2,graphics:{preset:'custom',shadows:'medium',clouds:'high',resolution:.65,viewDistance:200,fog:50,normalStrength:1.4,exposure:1.05,fov:78,cloudSpeed:1,ssgi:false,waterQuality:'high'}})));
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!!globalThis.__renderQA,{},{timeout:90000});
 console.log('BACKEND',await page.evaluate(()=>({gpu:__renderQA.renderer.backend.isWebGPUBackend,description:__renderQA.renderer.backend.adapter?.info?.description})));
 await page.evaluate(()=>{document.querySelectorAll('.overlay').forEach(x=>x.classList.add('hidden'));document.body.classList.add('playing');document.querySelector('#hud').style.display='block';const q=__renderQA;while(q.world.streamQueue.length)q.world.processStreaming(100,100);q.camera.updateMatrixWorld(true);});
 async function shot(name,options){
  const result=await page.evaluate(async opts=>{
   const q=__renderQA;q.env.setShadows(opts.shadows??'medium');q.lighting.setEnabled(Boolean(opts.gi));
   if(opts.sun){q.camera.position.set(36,9,-4);q.camera.lookAt(q.camera.position.clone().add(q.env.direction));}
   for(let i=0;i<4;i++){q.camera.updateMatrixWorld(true);q.env.update(.2,1);q.clouds.update(.2);q.lighting.render();await q.renderer.backend.device?.queue.onSubmittedWorkDone();}
   return {gpu:q.renderer.backend.isWebGPUBackend,gi:q.lighting.enabled,fault:q.lighting.faulted,stats:q.world.getStreamStats(),flare:[...document.querySelectorAll('.sun-flare')].map(e=>({opacity:getComputedStyle(e).opacity,background:getComputedStyle(e).backgroundImage,transform:e.style.transform}))};
  },options);
  await page.screenshot({path:`qa-results/${name}.png`});console.log(name,JSON.stringify(result));
 }
 await shot('terrain-shadow-no-gi',{shadows:'medium',gi:false});
 await shot('terrain-no-shadow-no-gi',{shadows:'off',gi:false});
 await shot('terrain-shadow-gi',{shadows:'medium',gi:true});
 await shot('sun-clouds-flares',{shadows:'medium',gi:false,sun:true});
 const cloud=await page.evaluate(()=>{
  const canvas=__renderQA.clouds.texture.image,ctx=canvas.getContext('2d'),data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let max=0,count=0;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(x<4||y<4||x>=canvas.width-4||y>=canvas.height-4){const a=data[(y*canvas.width+x)*4+3];max=Math.max(max,a);if(a)count++;}
  return {maxEdgeAlpha:max,nonzeroEdgePixels:count,data:canvas.toDataURL()};
 });
 await fs.writeFile('qa-results/cloud-alpha.png',Buffer.from(cloud.data.split(',')[1],'base64'));delete cloud.data;console.log('CLOUD',JSON.stringify(cloud));
 console.log('ERRORS',JSON.stringify(errors));
}finally{await fs.writeFile('qa-results/errors.json',JSON.stringify(errors,null,2));await browser?.close();server.kill();}

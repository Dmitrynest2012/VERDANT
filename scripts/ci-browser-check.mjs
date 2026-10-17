/** Проверка реального DOM, IndexedDB и компиляции водного шейдера на Windows CI. */
if(process.env.CI!=='true') {
  console.log('[VERDANT] Browser smoke runs on Windows CI; local logic tests are separate.');
} else {
  const {chromium}=await import('playwright');
  const {spawn,execFileSync}=await import('node:child_process');
  const {createRequire}=await import('node:module');
  const path=await import('node:path');
  const fs=await import('node:fs/promises');
  const require=createRequire(import.meta.url);
  execFileSync(process.execPath,[require.resolve('playwright/cli'),'install','chromium'],{stdio:'inherit',timeout:180000});
  const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5197','--strictPort'],{stdio:'pipe',windowsHide:true});
  const base='http://127.0.0.1:5197';
  let browser;
  try {
    for(let n=0;n<100;n++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
    browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-unsafe-webgpu']});
    const page=await browser.newPage({viewport:{width:960,height:640}});
    await page.addInitScript(()=>{
      if(!localStorage.getItem('verdant-ci-legacy')){
        localStorage.setItem('verdant-ci-legacy','1');
        localStorage.setItem('verdant-world-v1',JSON.stringify({version:1,edits:{},graphicsSchema:2,musicEnabled:false,
          graphics:{preset:'custom',shadows:'off',clouds:'off',resolution:.55,viewDistance:50,fog:50,normalStrength:1.4,
            exposure:1.05,fov:78,cloudSpeed:1,ssgi:false,waterQuality:'high'}}));
      }
    });
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{
      if(m.type()==='error')console.log('[BROWSER]',m.text().slice(0,700));
      if(/GPUValidationError|Error while parsing WGSL|shader compilation failed|invalid shader module/i.test(m.text()))errors.push(m.text());
    });
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>/^(WebGPU|WebGL2)/.test(document.querySelector('#backend')?.textContent||''),{},{timeout:60000});
    await page.waitForFunction(()=>document.body.dataset.worldReady==='true',{},{timeout:60000});
    if(await page.locator('#fatal-screen').isVisible())throw Error(await page.locator('#fatal-detail').textContent());
    const data=await page.evaluate(async()=>{
      const {SaveRepository}=await import('/src/storage/SaveRepository.js');
      const {newWorldState}=await import('/src/storage/SaveSchema.js');
      const repo=await new SaveRepository(indexedDB,'verdant-ci-data').open();
      const a=await repo.create('База QA',newWorldState({seed:123}));
      const s=(await repo.load(a.id)).state;s.water.edits['1,4,1']=8;await repo.save(a.id,s);
      s.edits['1,3,1']=0;await repo.save(a.id,s);
      const b=await repo.load(a.id,true);if(b.state.edits['1,3,1']!==undefined)throw Error('Backup lost');
      await repo.rename(a.id,'Переименованный мир');const file=await repo.exportSlot(a.id);
      const imported=await repo.importSlot(JSON.stringify(file));if(imported.id===a.id)throw Error('Import overwrote original');
      let protectedDelete=false;try{await repo.remove(a.id);}catch{protectedDelete=true;}
      if(!protectedDelete)throw Error('Active slot deletion was permitted');await repo.remove(imported.id);
      const revision=(await repo.load(a.id)).meta.revision;
      await Promise.all(Array.from({length:8},(_,i)=>repo.save(a.id,{...s,playSeconds:i})));
      const final=await repo.load(a.id);if(final.meta.revision!==revision+8||final.state.playSeconds!==7)throw Error('Save ordering');
      const tx=repo.db.transaction('states','readwrite');
      await new Promise((resolve,reject)=>{const r=tx.objectStore('states').get(a.id);r.onsuccess=()=>tx.objectStore('states').put({...r.result,digest:'damaged'});tx.oncomplete=resolve;tx.onabort=reject;});
      const recovered=await repo.load(a.id);
      if(!recovered.recovered)throw Error('Missing checksum recovery');
      await repo.save(a.id,recovered.state);
      if((await repo.load(a.id,true)).state.playSeconds!==6)throw Error('Corruption replaced valid backup');
      repo.close();return {slots:true,rename:true,backups:true,checksum:true,importExport:true,deleteProtection:true,orderedWrites:true};
    });
    console.log('[VERDANT IDB]',JSON.stringify(data));
    await page.locator('#new-btn').click();
    await page.locator('.save-dialog:not(.hidden)').waitFor();
    await page.locator('.save-name').fill('Новый мир из интерфейса');
    await page.locator('.save-seed').fill('170621');
    await page.locator('.save-dialog button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelector('#save-chip')?.textContent==='Новый мир из интерфейса',{},{timeout:60000});
    await page.waitForFunction(()=>document.body.dataset.worldReady==='true',{},{timeout:60000});
    await page.locator('#start-btn').click();
    await page.waitForFunction(()=>document.body.classList.contains('playing'),{},{timeout:15000});
    await page.keyboard.press('F5');await page.keyboard.press('F8');
    await page.locator('#save-screen:not(.hidden)').waitFor();
    await page.locator('[data-action="as"]').click();
    await page.locator('.save-name').fill('Отдельный снимок');
    await page.locator('.save-dialog button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelector('#save-chip')?.textContent==='Отдельный снимок');
    await page.keyboard.press('Escape');
    // Отдельный слот для проверки погружения: текущий мир не перезаписывается.
    await page.evaluate(async()=>{
      const {SaveRepository}=await import('/src/storage/SaveRepository.js');
      const {newWorldState}=await import('/src/storage/SaveSchema.js');
      const {SurfaceHydrology}=await import('/src/core/SurfaceHydrology.js');
      const repo=await new SaveRepository().open(),current=await repo.load(await repo.active());
      const s=newWorldState({seed:170621,graphics:current.state.graphics,musicEnabled:false});
      const c=new SurfaceHydrology(170621,2).column(48,-32);
      s.player={position:{x:48.5,y:c.waterY-2,z:-31.5},yaw:0,pitch:0};
      await repo.create('Подводный QA',s);repo.close();
    });
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#save-chip')?.textContent==='Подводный QA',{},{timeout:60000});
    await page.waitForFunction(()=>/^(WebGPU|WebGL2)/.test(document.querySelector('#backend')?.textContent||''),{},{timeout:60000});
    await page.waitForFunction(()=>document.body.dataset.worldReady==='true',{},{timeout:60000});
    await page.locator('#start-btn').click();
    await page.waitForFunction(()=>document.body.classList.contains('underwater'),{},{timeout:30000});
    await page.keyboard.down('Space');
    try{await page.waitForFunction(()=>!document.body.classList.contains('underwater'),{},{timeout:25000});}finally{await page.keyboard.up('Space');}
    await page.waitForTimeout(1500);
    if(await page.locator('#fatal-screen').isVisible())throw Error(await page.locator('#fatal-detail').textContent());
    if(errors.length)throw Error(errors.join('\n'));
    console.log('[VERDANT BROWSER] PASS: new world, named save in game, IndexedDB, swimming, water shader. Backend:',await page.locator('#backend').textContent());
    await fs.mkdir('qa-results',{recursive:true});await page.screenshot({path:path.join('qa-results','water-smoke.png')});
  }finally{await browser?.close();server.kill();}
}

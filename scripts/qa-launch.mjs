import {chromium} from 'playwright';
/** Только изолированный CI. Флаги программного GPU не попадают в приложение. */
export async function launchQA(base) {
 const common=['--no-sandbox','--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--use-webgpu-adapter=swiftshader'];
 const variants=[
  [...common,'--use-angle=swiftshader'],
  [...common,'--use-angle=swiftshader','--enable-features=Vulkan','--disable-vulkan-surface'],
  [...common,'--use-angle=vulkan','--use-vulkan=swiftshader','--enable-features=Vulkan','--disable-vulkan-surface']
 ];
 for(let i=0;i<variants.length;i++) {
  const browser=await chromium.launch({channel:'chrome',headless:false,args:variants[i]});
  const page=await browser.newPage();
  page.on('console',m=>{if(m.type()==='warning'||m.type()==='error')console.log('PROBE',i,m.text().slice(0,800));});
  try {
   await page.route(base+'/__qa_probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Trusted graphics test</title>'}));
   await page.goto(base+'/__qa_probe');
   const info=await page.evaluate(async()=>{
    const T=await import('/node_modules/three/build/three.webgpu.js');
    const r=new T.WebGPURenderer();await r.init();r.setSize(64,64);
    const scene=new T.Scene(),camera=new T.PerspectiveCamera(60,1,.1,10);camera.position.z=3;
    scene.add(new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial({color:0xffffff})));
    r.render(scene,camera);await r.backend.device?.queue.onSubmittedWorkDone();
    const result={gpu:r.backend.isWebGPUBackend===true,revision:T.REVISION};r.dispose();return result;
   });
   console.log('PROBE RESULT',i,JSON.stringify(info),browser.version());
   await page.close();
   if(info.gpu)return browser;
  }catch(error){console.log('PROBE ERROR',i,error.message.slice(0,1200));}
  await browser.close();
 }
 throw Error('No working current WebGPU backend in this CI image');
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
async function bridge() {
 const source=await fs.readFile(new URL('../electron/preload.cjs',import.meta.url),'utf8');
 const sent=[],listeners=new Map();let api;
 vm.runInNewContext(source,{require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'verdantDesktop');api=value;}},
  ipcRenderer:{on:(ch,fn)=>listeners.set(ch,fn),send:(...args)=>sent.push(args),removeListener:ch=>listeners.delete(ch)}})});
 return {api,sent,listeners};
}
const token='save-12345678-1234-1234-1234-123456789abc';
test('Electron ждёт завершения сохранения, потом выдаёт ACK',async()=>{
 const b=await bridge();let finish;const task=new Promise(r=>finish=r);
 const unsubscribe=b.api.onSaveBeforeClose(()=>task);assert.equal(b.sent[0][0],'verdant:save-ready');
 const pending=b.listeners.get('verdant:prepare-close')({},token);assert.equal(b.sent.length,1);
 finish();await pending;assert.equal(b.sent[1][1].ok,true);unsubscribe();assert.equal(b.listeners.size,0);
});
test('Ошибка сохранения передаётся без успешного ACK и без раскрытия файлового API',async()=>{
 const b=await bridge();assert.deepEqual(Object.keys(b.api),['onSaveBeforeClose']);
 b.api.onSaveBeforeClose(async()=>{throw Error('Квота исчерпана');});
 await b.listeners.get('verdant:prepare-close')({},'invalid');assert.equal(b.sent.length,1);
 await b.listeners.get('verdant:prepare-close')({},token);assert.equal(b.sent[1][1].ok,false);assert.equal(b.sent[1][1].message,'Квота исчерпана');
});

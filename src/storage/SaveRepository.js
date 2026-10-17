import { LEGACY_KEY, RECOVERY_KEY, MAX_SLOTS, MAX_IMPORT_BYTES, normalizeState, cleanSaveName, stateDigest } from './SaveSchema.js';

const DATABASE='verdant-saves-v2';
const STORES=['slots','states','backups','settings'];
const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});

/** IndexedDB: метаданные, мир и его предыдущая версия меняются одной транзакцией. */
export class SaveRepository {
  constructor(indexedDB=globalThis.indexedDB,name=DATABASE) {this.idb=indexedDB;this.name=name;this.db=null;this.queue=Promise.resolve();}
  async open() {
    if(this.db) return this;
    if(!this.idb) throw new Error('Хранилище сохранений недоступно. Не очищайте данные приложения.');
    const req=this.idb.open(this.name,1);
    req.onupgradeneeded=()=>{for(const n of STORES) if(!req.result.objectStoreNames.contains(n)) req.result.createObjectStore(n,{keyPath:n==='settings'?'key':'id'});};
    this.db=await request(req);
    this.db.onversionchange=()=>{this.db.close();this.db=null;};
    return this;
  }
  serial(action) {const p=this.queue.then(action);this.queue=p.catch(()=>{});return p;}
  transaction(names,mode,body) {
    return new Promise((resolve,reject)=>{
      let tx;
      try {tx=this.db.transaction(names,mode,mode==='readwrite'?{durability:'strict'}:undefined);}
      catch {tx=this.db.transaction(names,mode);}
      let result;
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(tx.error||new Error('Запись отменена. Предыдущая версия сохранена.'));
      tx.onerror=()=>{};
      try {body(tx,value=>{result=value;});} catch(error) {tx.abort();reject(error);}
    });
  }
  async list() {await this.queue;return request(this.db.transaction('slots').objectStore('slots').getAll());}
  async active() {await this.queue;return (await request(this.db.transaction('settings').objectStore('settings').get('active')))?.value||null;}
  select(id) {return this.serial(()=>this.transaction(['slots','settings'],'readwrite',(tx,done)=>{
    const req=tx.objectStore('slots').get(id);
    req.onsuccess=()=>{if(!req.result){tx.abort();return;}tx.objectStore('settings').put({key:'active',value:id});done(id);};
  }));}
  create(name,state,{id=crypto.randomUUID(),select=true}={}) {
    const title=cleanSaveName(name), normalized=normalizeState(state);
    return this.serial(async()=>{
      const digest=await stateDigest(normalized),now=Date.now();
      const meta={id,name:title,createdAt:now,updatedAt:now,revision:1,seed:normalized.seed,
        generatorVersion:normalized.generatorVersion,playSeconds:normalized.playSeconds};
      return this.transaction(STORES,'readwrite',(tx,done)=>{
        const slots=tx.objectStore('slots'),count=slots.count();
        count.onsuccess=()=>{
          if(count.result>=MAX_SLOTS){tx.abort();return;}
          // add, не put: повторная миграция не перезапишет существующий слот.
          slots.add(meta);tx.objectStore('states').add({id,state:normalized,digest,revision:1});
          if(select)tx.objectStore('settings').put({key:'active',value:id});done(meta);
        };
      });
    });
  }
  save(id,state) {
    const normalized=normalizeState(state);
    return this.serial(async()=>{
      const digest=await stateDigest(normalized);
      const previous=await request(this.db.transaction('states').objectStore('states').get(id));
      let previousValid=false;
      try {previousValid=Boolean(previous && await stateDigest(previous.state)===previous.digest);}catch{}
      return this.transaction(STORES,'readwrite',(tx,done)=>{
        const old=tx.objectStore('states').get(id);
        old.onsuccess=()=>{
          if(!old.result || old.result.revision!==previous?.revision){tx.abort();return;}
          const metaReq=tx.objectStore('slots').get(id);
          metaReq.onsuccess=()=>{
            const meta=metaReq.result;
            if(!meta){tx.abort();return;}
            // Одинаковый снимок не вытесняет полезный резерв при повторном Save.
            if(previousValid && old.result.digest!==digest) tx.objectStore('backups').put(old.result);
            const revision=meta.revision+1;
            tx.objectStore('states').put({id,state:normalized,digest,revision});
            const updated={...meta,updatedAt:Date.now(),revision,seed:normalized.seed,
              generatorVersion:normalized.generatorVersion,playSeconds:normalized.playSeconds};
            tx.objectStore('slots').put(updated);done(updated);
          };
        };
      });
    });
  }
  async load(id,backupOnly=false) {
    await this.queue;
    const tx=this.db.transaction(['slots','states','backups']);
    const [meta,record,backup]=await Promise.all(['slots','states','backups'].map(n=>request(tx.objectStore(n).get(id))));
    if(!meta) throw new Error('Слот не найден.');
    for(const [value,recovered] of backupOnly?[[backup,true]]:[[record,false],[backup,true]]) {
      if(!value)continue;
      try {if(await stateDigest(value.state)!==value.digest)continue;return {meta,state:normalizeState(value.state),recovered};}catch{}
    }
    throw new Error('Сохранение и резерв не читаются. Экспортируйте данные; не удаляйте слот.');
  }
  rename(id,name) {
    const title=cleanSaveName(name);
    return this.serial(()=>this.transaction('slots','readwrite',(tx,done)=>{
      const store=tx.objectStore('slots'),req=store.get(id);
      req.onsuccess=()=>{if(!req.result){tx.abort();return;}store.put({...req.result,name:title});done(title);};
    }));
  }
  remove(id) {return this.serial(()=>this.transaction(STORES,'readwrite',(tx,done)=>{
    const req=tx.objectStore('settings').get('active');
    req.onsuccess=()=>{
      // Активный слот не удаляем: сначала пользователь должен загрузить другой.
      if(req.result?.value===id){tx.abort();return;}
      for(const n of ['slots','states','backups'])tx.objectStore(n).delete(id);done(true);
    };
  }));}
  async exportSlot(id) {
    const {meta,state}=await this.load(id);
    return {format:'VERDANT-SAVE',schema:1,name:meta.name,exportedAt:new Date().toISOString(),state,digest:await stateDigest(state)};
  }
  async importSlot(text) {
    if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_IMPORT_BYTES)throw new Error('Файл слишком большой.');
    const data=JSON.parse(text);
    if(data.format!=='VERDANT-SAVE'||data.schema!==1||await stateDigest(data.state)!==data.digest)throw new Error('Файл повреждён или имеет другой формат.');
    return this.create(cleanSaveName(data.name),data.state,{select:false});
  }
  async migrateLegacy(storage=globalThis.localStorage) {
    // Маркер в БД, а исходный localStorage остаётся нетронутой резервной копией.
    const marker=await request(this.db.transaction('settings').objectStore('settings').get('legacyImported'));
    if(marker)return null;
    const raw=storage?.getItem(LEGACY_KEY);
    if(!raw)return null;
    let state;
    try{state=normalizeState(JSON.parse(raw));}catch(error){console.warn('Старый мир оставлен без изменений:',error);return null;}
    const slots=await this.list();
    let meta=slots.find(s=>s.id==='legacy-v1');
    if(!meta)meta=await this.create('Мой прежний мир',state,{id:'legacy-v1',select:slots.length===0});
    await this.transaction('settings','readwrite',(tx)=>tx.objectStore('settings').put({key:'legacyImported',value:true}));
    return meta;
  }
  async recoverJournal(storage=globalThis.localStorage) {
    const raw=storage?.getItem(RECOVERY_KEY);if(!raw)return null;
    let j;
    try{j=JSON.parse(raw);}catch{return null;}
    const current=(await this.list()).find(s=>s.id===j.id);
    if(current && Number(j.timestamp)>current.updatedAt && j.state) {
      try{await this.save(j.id,normalizeState(j.state));storage.removeItem(RECOVERY_KEY);return j.id;}
      catch(error){console.warn('Повреждённый журнал оставлен для восстановления:',error);return null;}
    }
    return null;
  }
  flush() {return this.queue;}
  close() {this.db?.close();this.db=null;}
}

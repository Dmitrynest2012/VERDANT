/** Минимальный IPC-мост. Никаких путей файлов, Node.js или произвольных каналов в рендере. */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('verdantDesktop', {
  onSaveBeforeClose(handler) {
    if(typeof handler!=='function')throw new TypeError('Ожидается функция сохранения.');
    const listener=async(_event,token)=>{
      if(typeof token!=='string'||!/^save-[0-9a-f-]{36}$/.test(token))return;
      try{await handler();ipcRenderer.send('verdant:save-ack',{token,ok:true});}
      catch(error){ipcRenderer.send('verdant:save-ack',{token,ok:false,message:String(error?.message||error).slice(0,300)});}
    };
    ipcRenderer.on('verdant:prepare-close',listener);
    ipcRenderer.send('verdant:save-ready');
    return ()=>ipcRenderer.removeListener('verdant:prepare-close',listener);
  }
});

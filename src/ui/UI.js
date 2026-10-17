import { HOTBAR_COUNT, SLOT_COUNT } from '../core/Inventory.js';
import { BLOCK_ITEMS, BLOCK_ITEM_BY_TYPE, MIN_WORLD_Y, MAX_WORLD_Y } from '../core/Terrain.js';
const $=id=>document.getElementById(id);
/** Интерфейс самостоятельный от WebGPU и физики. */
export class UI {
  constructor(inventory,hooks,hasSave) {
    this.inventory=inventory;this.hooks=hooks;this.mode='title';this.selected=0;this.backend='Загрузка…';this.toastTimer=0;
    this.hotbar=$('hotbar');this.backpack=$('backpack-grid');this.inventoryHotbar=$('inventory-hotbar');
    this.heldStack=$('held-stack');this.invPanel=$('inventory-screen');this.mapPanel=$('map-screen');this.giInput=$('gi-toggle');
    this.graphicsInputs=[...document.querySelectorAll('[data-graphic]')];
    this.bind();this.buildSlots();this.inventory.onChange=()=>this.render();
    if(hasSave)$('start-btn').innerHTML='Продолжить мир <span>→</span>';
    $('new-btn').classList.remove('hidden');this.render();
    document.addEventListener('mousemove',event=>{this.heldStack.style.left=`${event.clientX+15}px`;this.heldStack.style.top=`${event.clientY+17}px`;});
  }
  bind() {
    $('start-btn').addEventListener('click',()=>this.hooks.onResume());
    $('resume-btn').addEventListener('click',()=>this.hooks.onResume());
    $('new-btn').addEventListener('click',()=>this.hooks.onNew());
    $('inventory-close').addEventListener('click',()=>this.closeInventory());
    $('inventory-from-pause').addEventListener('click',()=>this.openInventory());
    $('saves-title-btn').addEventListener('click',()=>this.hooks.onSaves());
    $('saves-pause-btn').addEventListener('click',()=>this.hooks.onSaves());
    $('new-pause-btn').addEventListener('click',()=>this.hooks.onNew());
    $('save-btn').addEventListener('click',()=>this.hooks.onSave());
    $('music-btn').addEventListener('click',()=>this.hooks.onMusicToggle());
    $('map-close').addEventListener('click',()=>this.hooks.onMapClose());
    $('map-zoom-in').addEventListener('click',()=>this.hooks.onMapZoom(-1));
    $('map-zoom-out').addEventListener('click',()=>this.hooks.onMapZoom(1));
    for(const control of document.querySelectorAll('[data-map-level]'))control.addEventListener('click',()=>this.hooks.onMapLevel(Number(control.dataset.mapLevel)));
    this.mapPanel.addEventListener('wheel',event=>{event.preventDefault();this.hooks.onMapZoom(event.deltaY>0?1:-1);},{passive:false});
    $('music-volume').addEventListener('input',e=>{$('music-value').textContent=`${e.target.value}%`;this.hooks.onVolume(Number(e.target.value)/100);});
    this.giInput.addEventListener('change',()=>this.hooks.onGIToggle(this.giInput.checked));
    $('graphics-preset').addEventListener('change',e=>this.hooks.onGraphicsPreset(e.target.value));
    for(const input of this.graphicsInputs){
      const event=input.tagName==='SELECT'?'change':'input';
      input.addEventListener(event,()=>this.hooks.onGraphicsChange(input.dataset.graphic,input.tagName==='SELECT'?input.value:Number(input.value)));
    }
    this.invPanel.addEventListener('contextmenu',e=>e.preventDefault());
  }
  makeBlockIcon(type='grass') {
    const div=document.createElement('span');div.className=`mini-voxel mini-${type}`;
    div.innerHTML='<span class="cube-top"></span><span class="cube-left"></span><span class="cube-right"></span>';return div;
  }
  createSlot(index,isHUD=false) {
    const button=document.createElement('button');button.type='button';button.className=`slot ${isHUD?'hud-slot':'inv-slot'}`;
    button.dataset.index=index;button.setAttribute('aria-label',`Слот ${index+1}`);
    button.innerHTML='<span class="slot-number"></span><span class="slot-content"></span><span class="slot-count"></span>';
    button.querySelector('.slot-content').appendChild(this.makeBlockIcon());
    if(isHUD)button.addEventListener('click',()=>this.setSelected(index));
    else{
      button.addEventListener('mousedown',event=>{
        if(event.button!==0&&event.button!==2)return;event.preventDefault();
        if(event.shiftKey&&event.button===0)this.inventory.quickMove(index);
        else if(event.button===2)this.inventory.rightClick(index);else this.inventory.leftClick(index);
      });
      button.addEventListener('contextmenu',e=>e.preventDefault());
    }
    return button;
  }
  buildSlots() {
    for(let i=0;i<HOTBAR_COUNT;i++){this.hotbar.appendChild(this.createSlot(i,true));this.inventoryHotbar.appendChild(this.createSlot(i,false));}
    for(let i=HOTBAR_COUNT;i<SLOT_COUNT;i++)this.backpack.appendChild(this.createSlot(i,false));
  }
  render() {
    for(const s of [...this.hotbar.children,...this.backpack.children,...this.inventoryHotbar.children]) {
      const index=Number(s.dataset.index),item=this.inventory.get(index);
      s.classList.toggle('filled',Boolean(item));s.classList.toggle('selected',s.classList.contains('hud-slot')&&index===this.selected);
      s.querySelector('.slot-count').textContent=item&&item.count>1?`${item.count}`:'';
      const icon=s.querySelector('.mini-voxel');if(icon&&item)icon.className=`mini-voxel mini-${item.id}`;
      const n=s.querySelector('.slot-number');if(n)n.textContent=index<HOTBAR_COUNT?String(index+1):'';
    }
    const chosen=this.inventory.get(this.selected);
    $('selected-label').textContent=chosen?BLOCK_ITEMS[chosen.id]?.title??chosen.id:'Переносной бур';
    $('action-hint').textContent=chosen?.id==='bucket'?'ПКМ — набрать воду из источника':chosen?.id==='water_bucket'?'ПКМ — вылить воду':chosen?'ЛКМ — добыть · ПКМ — поставить':'ЛКМ — добыть · Возьми блок для строительства';
    this.heldStack.classList.toggle('hidden',!this.inventory.held||this.mode!=='inventory');
    if(this.inventory.held)this.heldStack.innerHTML=`<span class="cursor-cube cube-${this.inventory.held.id}"></span><strong>${this.inventory.held.count}</strong>`;
  }
  setSelected(index){this.selected=(index+HOTBAR_COUNT)%HOTBAR_COUNT;this.render();}
  showOnly(name) {
    this.mode=name;
    $('title-screen').classList.toggle('hidden',name!=='title');$('pause-screen').classList.toggle('hidden',name!=='pause');
    $('inventory-screen').classList.toggle('hidden',name!=='inventory');this.mapPanel.classList.toggle('hidden',name!=='map');
    $('hud').classList.toggle('hidden',name==='title');document.body.classList.toggle('playing',name==='play');
    document.body.classList.toggle('menu-open',name!=='play');this.render();
  }
  showPlay(){this.showOnly('play');}
  showPause(){this.showOnly('pause');}
  showMap(){this.showOnly('map');}
  startMapClose(){this.showOnly('map-closing');}
  openInventory(){if(this.mode!=='play'&&this.mode!=='pause')return;this.showOnly('inventory');if(document.pointerLockElement)document.exitPointerLock();}
  closeInventory(){if(this.mode!=='inventory')return;this.inventory.returnHeld();this.hooks.onResume();}
  setBackend(isWebGPU){this.backend=isWebGPU?'WebGPU':'WebGL2 (резерв)';$('backend').textContent=this.backend;}
  setGI(supported,enabled) {
    const available=Boolean(supported),active=available&&Boolean(enabled);this.giInput.disabled=!available;this.giInput.checked=active;
    $('gi-status').textContent=!available?'SSGI недоступен: используется базовое освещение.':active?'SSGI включено (WebGPU).':'SSGI выключено; используется базовое освещение.';
  }
  setMusic(playing){const b=$('music-btn');b.textContent=playing?'♫ Выключить музыку':'♫ Включить музыку';b.setAttribute('aria-pressed',playing?'true':'false');}
  setMusicStatus(message,warning=false){const s=$('music-status');s.textContent=String(message);s.classList.toggle('asset-warning',Boolean(warning));}
  setTextures(normalLoaded,total=4) {
    $('normals-status').textContent=`Нормали ${normalLoaded}/${total}`;
    $('normals-status').title=normalLoaded===total?`${total} карт нормалей 1024×1024 активны`:'Не все карты нормалей найдены. Распакуйте архив текстур в public/textures/';
    $('normals-status').classList.toggle('asset-warning',normalLoaded!==total);
  }
  setGraphics(settings) {
    $('graphics-preset').value=settings.preset;
    for(const control of this.graphicsInputs)control.value=String(settings[control.dataset.graphic]);
    const values={resolution:`${Math.round(settings.resolution*100)}%`,viewDistance:`${settings.viewDistance} м`,fog:`${settings.fog}%`,
      normalStrength:`${Math.round(settings.normalStrength*100)}%`,exposure:Number(settings.exposure).toFixed(2),fov:`${settings.fov}°`,cloudSpeed:`${Number(settings.cloudSpeed).toFixed(1)}×`};
    for(const [k,v]of Object.entries(values)){const output=$(`value-${k}`);if(output)output.textContent=v;}
  }
  setVolume(v){$('music-volume').value=`${Math.round(v*100)}`;$('music-value').textContent=`${Math.round(v*100)}%`;}
  setTarget(target,progress=0) {
    $('target-label').classList.toggle('hidden',!target||this.mode!=='play');
    if(target)$('target-label').textContent=target.type===7?(target.fluid===8?'Вода · источник':'Текущая вода'):BLOCK_ITEMS[BLOCK_ITEM_BY_TYPE[target.type]]?.title??'Блок';
    const mining=Boolean(target&&progress>0&&this.mode==='play');$('mining-progress').classList.toggle('hidden',!mining);
    $('mining-fill').style.width=`${Math.min(100,progress*100)}%`;
  }
  setSaveLabel(name,status=''){const chip=$('save-chip');if(chip){chip.textContent=name;chip.title=status||name;}}
  setSwimming(player) {
    const label=$('swim-status');if(!label)return;label.classList.toggle('hidden',!player.inWater||this.mode!=='play');
    label.textContent=player.submerged?'Под водой · WASD + взгляд · Space ↑ · Ctrl ↓ · Shift быстрее':'Плавание · Space — всплыть / выйти на берег · Ctrl — нырнуть';
  }
  setStats(player,fps,stream=null) {
    const p=player.position,n=v=>`${v>=0?'+':''}${v.toFixed(1)}`;
    $('nav-x').textContent=n(p.x);$('nav-z').textContent=n(p.z);$('nav-y').textContent=`${n(p.y)} м`;$('nav-y').classList.toggle('below-zero',p.y<0);
    const fraction=Math.max(0,Math.min(1,(p.y-MIN_WORLD_Y)/(MAX_WORLD_Y-MIN_WORLD_Y)));
    $('altitude-marker').style.left=`${fraction*100}%`;$('altitude-bar').style.width=`${fraction*100}%`;$('fps').textContent=`${Math.round(fps)} FPS`;
    if(stream)$('stream-stats').textContent=`V ${stream.sections} · LOD ${stream.farTiles} · +${stream.pending}`;
  }
  swingPickaxe(){const el=$('pickaxe');el.classList.remove('swing');void el.offsetWidth;el.classList.add('swing');}
  setToolWorking(active){const el=$('pickaxe');if(el)el.classList.toggle('working',Boolean(active));}
  toast(message,duration=2700){const el=$('toast');el.textContent=message;el.classList.remove('hidden');window.clearTimeout(this.toastTimer);this.toastTimer=window.setTimeout(()=>el.classList.add('hidden'),duration);}
  fatal(error){this.showOnly('title');$('title-screen').classList.add('hidden');$('fatal-screen').classList.remove('hidden');$('fatal-detail').textContent=String(error?.message||error);}
}

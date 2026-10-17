import { SEED, BLOCK_ITEMS, MIN_WORLD_Y, MAX_WORLD_Y, WORLD_HALF } from '../core/Terrain.js';

export const LEGACY_KEY='verdant-world-v1';
export const RECOVERY_KEY='verdant-recovery-v2';
export const MAX_IMPORT_BYTES=24*1024*1024;
export const MAX_SLOTS=100;
export function cleanSaveName(name) {
  if(typeof name!=='string') throw new Error('Введите название сохранения.');
  const result=name.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,64);
  if(!result) throw new Error('Название не может быть пустым.');
  return result;
}
function plain(value) {return value && typeof value==='object' && !Array.isArray(value);}
function validateEdits(value,maximum) {
  if(!plain(value)) throw new Error('Повреждён список изменений мира.');
  const entries=Object.entries(value);
  if(entries.length>300000) throw new Error('Слишком много изменений для этой версии формата.');
  for(const [key,id] of entries) {
    const parts=key.split(',');
    const [x,y,z]=parts.map(Number);
    if(parts.length!==3 || !parts.every(s=>/^-?\d+$/.test(s)) || ![x,y,z].every(Number.isSafeInteger) ||
      x < -WORLD_HALF || x >= WORLD_HALF || z < -WORLD_HALF || z >= WORLD_HALF || y<MIN_WORLD_Y || y>MAX_WORLD_Y ||
      !Number.isInteger(id)||id<0||id>maximum) throw new Error('Недопустимый блок в сохранении.');
  }
}
/** Проверка не исполняет содержимое JSON и не допускает частичное повреждение мира. */
export function normalizeState(source) {
  if(!plain(source)||![1,2].includes(source.version)) throw new Error('Неподдерживаемый формат сохранения.');
  const state=structuredClone(source);
  state.version=2;
  state.seed=source.seed ?? SEED;
  state.generatorVersion=source.generatorVersion ?? 1;
  if(!Number.isInteger(state.seed)||state.seed<0||state.seed>4294967295) throw new Error('Некорректный seed мира.');
  if(![1,2].includes(state.generatorVersion)) throw new Error('Сохранение требует более нового генератора.');
  state.edits=state.edits ?? {};
  validateEdits(state.edits,6);
  state.water=state.water ?? {version:1,edits:{}};
  if(state.water.version!==1) throw new Error('Неподдерживаемый формат воды.');
  validateEdits(state.water.edits,9);
  if(source.player!=null) {
    const p=source.player.position;
    if(!plain(p)||![p.x,p.y,p.z,source.player.yaw,source.player.pitch].every(Number.isFinite) ||
       Math.abs(p.x)>WORLD_HALF+10||Math.abs(p.z)>WORLD_HALF+10||p.y<MIN_WORLD_Y-20||p.y>MAX_WORLD_Y+20)
      throw new Error('Повреждена позиция персонажа.');
  }
  if(source.inventory!=null) {
    if(!Array.isArray(source.inventory)||source.inventory.length!==36) throw new Error('Повреждён инвентарь.');
    for(const s of source.inventory) if(s!==null && (!plain(s)||!Object.hasOwn(BLOCK_ITEMS,s.id)||!Number.isInteger(s.count)||s.count<1||s.count>(BLOCK_ITEMS[s.id]?.stackMax??64)))
      throw new Error('Недопустимый предмет в сохранении.');
  }
  if(source.held!=null && (!plain(source.held)||!Object.hasOwn(BLOCK_ITEMS,source.held.id)||!Number.isInteger(source.held.count)||source.held.count<1||source.held.count>(BLOCK_ITEMS[source.held.id]?.stackMax??64)))
    throw new Error('Повреждён предмет на курсоре.');
  if(source.drops!=null && (!Array.isArray(source.drops)||source.drops.length>10000)) throw new Error('Повреждён список предметов мира.');
  state.playSeconds=Math.max(0,Math.min(1e10,Number(source.playSeconds)||0));
  return state;
}
export async function stateDigest(state) {
  const raw=new TextEncoder().encode(JSON.stringify(state));
  if(raw.length>MAX_IMPORT_BYTES) throw new Error('Сохранение превышает лимит 24 МиБ.');
  const digest=await crypto.subtle.digest('SHA-256',raw);
  return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export function newWorldState(options={}) {
  const seed=options.seed ?? crypto.getRandomValues(new Uint32Array(1))[0];
  return {version:2,seed,generatorVersion:2,edits:{},water:{version:1,edits:{}},
    player:null,inventory:null,held:null,drops:[],selected:0,playSeconds:0,toolsVersion:1,
    graphicsSchema:2,graphics:options.graphics,musicEnabled:options.musicEnabled??true,musicVolume:options.musicVolume??.3};
}

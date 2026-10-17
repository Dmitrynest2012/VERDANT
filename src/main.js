import * as THREE from 'three/webgpu';
import { Inventory } from './core/Inventory.js';
import { BLOCK_ITEMS, BLOCK_ITEM_BY_TYPE } from './core/Terrain.js';
import { sanitizeGraphics, graphicsPreset, graphicsChange, GRAPHICS_DEFAULTS, migrateGraphicsSettings } from './core/GraphicsSettings.js';
import { VoxelWorld } from './core/VoxelWorld.js';
import { Player } from './core/Player.js';
import { Drops } from './core/Drops.js';
import { Environment } from './gfx/Environment.js';
import { Clouds } from './gfx/Clouds.js';
import { Effects } from './gfx/Effects.js';
import { Lighting } from './gfx/Lighting.js';
import { UI } from './ui/UI.js';
import { WorldMap } from './ui/WorldMap.js';
import './style.css';

/** VERDANT v0.1.10006 — облака и солнце 2.0, ускоренная карта, переносной бур и аудио-поиск по нескольким именам. */
const SAVE_KEY = 'verdant-world-v1';
const stage = document.getElementById('stage');
const keys = new Set();
const mouse = { left: false, right: false };
let ui, renderer, world, player, inventory, env, fx, drops, lighting, camera, clouds, flashlight, flashlightTarget, worldMap;
let terrainMaterials=[];
let selectedTarget = null;
let miningTargetKey = '';
let miningProgress = 0;
let mineSwingTimer = 0;
let rightRepeat = 0;
let saveElapsed = 0;
let fpsCounter = 0;
let fpsTime = 0;
let fpsValue = 0;
let musicPlaying = false;
let initialized = false;
let graphicSettings={...GRAPHICS_DEFAULTS};
let settingsGI = true;
let musicWanted = true;
let musicAvailable = false;
let musicFileChecked = false;
let lightSampleTime = 0;
let visibilityTime = 0;
let skyExposureAtPlayer = 1;
let musicVolume = 0.30;
let lastTime = 0;
let flashlightEnabled = false;
const direction = new THREE.Vector3();
const MUSIC_CANDIDATES = ['/audio/relax.mp3','/audio/music.mp3','/audio/verdant.mp3','/audio/ambient.mp3','/audio/track.mp3','/audio/relax.ogg','/audio/music.ogg'];
let musicPath = MUSIC_CANDIDATES[0];
const music = new Audio(musicPath);
music.loop = true;
music.preload = 'metadata';
music.addEventListener('error', () => {
  if (ui) ui.setMusicStatus('Аудио не воспроизводится: проверьте public/audio/ (relax/music/ambient/track) и формат MP3/OGG.',true);
});

function readSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && data.version === 1 ? data : null;
  } catch (e) {
    console.warn('Не удалось прочитать сохранение:', e);
    return null;
  }
}

function saveGame(notify = false) {
  if (!initialized) return;
  const data = {
    version: 1,
    graphicsSchema: 2,
    timestamp: Date.now(),
    edits: world.toJSON(),
    inventory: inventory.toJSON(),
    player: player.toJSON(),
    selected: ui.selected,
    giEnabled: settingsGI, // поле v0.1.1 оставлено для старых сохранений
    graphics: graphicSettings,
    musicEnabled: musicWanted,
    musicVolume,
    drops: drops.toJSON()
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    if (notify) ui.toast('Мир и инвентарь сохранены');
  } catch (e) {
    console.error('Ошибка localStorage:', e);
    if (notify) ui.toast('Не удалось сохранить: проверь свободное место браузера');
  }
}

async function loadMaterials() {
  const loader=new THREE.TextureLoader();
  // Один файл earth_bottom используется и травяным блоком снизу, и землёй.
  const files=['grass_top.png','grass_side.png','earth_bottom.png','earth_stones.png','earth_compact.png','shale_layer.png','deep_stone.png'];
  const fallbackColors=['#8ec16f','#87aa6d','#8b7159','#878178','#786852','#6e7073','#5f666d'];
  let missing=0,normalLoaded=0;
  const materials=await Promise.all(files.map(async(filename,index)=>{
    let map=null,normalMap=null;
    try {
      map=await loader.loadAsync(`/textures/${filename}`);
      map.colorSpace=THREE.SRGBColorSpace;
      map.magFilter=THREE.LinearFilter;map.minFilter=THREE.LinearMipmapLinearFilter;
      map.anisotropy=8;map.wrapS=map.wrapT=THREE.RepeatWrapping;
    } catch(error) { missing++; console.warn(`Не найдена текстура ${filename}`,error); }
    try {
      normalMap=await loader.loadAsync(`/textures/${filename.replace('.png','_normal.png')}`);
      normalMap.colorSpace=THREE.NoColorSpace;
      normalMap.magFilter=THREE.LinearFilter;
      normalMap.minFilter=THREE.LinearMipmapLinearFilter;
      normalMap.anisotropy=8;normalMap.wrapS=normalMap.wrapT=THREE.RepeatWrapping;
      normalLoaded++;
    } catch(error) {console.info(`Нет normal map: ${filename}`,error);}
    return new THREE.MeshStandardMaterial({
      map,normalMap,normalMapType:THREE.TangentSpaceNormalMap,
      normalScale:new THREE.Vector2(1.4,1.4),
      color:map?'#ffffff':fallbackColors[index],
      roughness:index>=4?0.96:index===3?0.93:0.87,metalness:0,vertexColors:true
    });
  }));
  return {materials,missing,normalLoaded};
}

/** Браузер может отдавать index.html вместо отсутствующего MP3: проверяем тип. */
async function checkMusicFile() {
  musicAvailable = false;
  for (const candidate of MUSIC_CANDIDATES) {
    try {
      const response = await fetch(candidate, { method: 'HEAD', cache: 'no-store' });
      const type = (response.headers.get('content-type') || '').toLowerCase();
      const okay = response.ok && !type.includes('text/html') && !type.includes('text/plain');
      if (okay) {
        musicAvailable = true;
        musicPath = candidate;
        music.src = musicPath;
        break;
      }
    } catch {}
  }
  musicFileChecked = true;
  if (!musicAvailable) ui.setMusicStatus('Файл не найден. Положите MP3/OGG в public/audio/ как relax, music, ambient или track и нажмите N.', true);
  else ui.setMusicStatus(musicPlaying ? '▶ Музыка воспроизводится.' : `Файл найден (${musicPath.split('/').at(-1)}). Музыка включится при входе в игру.`);
  return musicAvailable;
}

async function startMusic(showToast=false) {
  try {
    music.volume=musicVolume;
    // ВАЖНО: play() должен вызываться синхронно в обработчике клика/M.
    // Нельзя ожидать fetch(HEAD), иначе браузер потеряет user activation.
    // При добавлении MP3 после загрузки игры переоткроем источник.
    if (!musicFileChecked) await checkMusicFile();
    if (!musicAvailable) throw new Error('missing-audio');
    if (music.src !== new URL(musicPath, window.location.href).href) music.src = musicPath;
    if(music.error) music.load();
    const request=music.play();
    await request;
    musicAvailable=true;
    musicPlaying=true;ui.setMusic(true);
    ui.setMusicStatus(musicVolume<=0?'Громкость 0% — увеличьте её ползунком.':'▶ Музыка воспроизводится.');
    if(showToast) ui.toast('Фоновая музыка включена · N — выключить',1500);
    return true;
  } catch(error) {
    musicPlaying=false;ui.setMusic(false);
    const missing=musicFileChecked && !musicAvailable;
    ui.setMusicStatus(missing
      ? 'Файл не найден: public/audio/(relax|music|ambient|track). Положите туда MP3/OGG и снова нажмите N.'
      : `Звук не запущен (${error?.name||'ошибка'}): проверьте файл, громкость и разрешения вкладки.`,true);
    console.warn('Аудио не воспроизводится:',error);
    if(showToast) ui.toast(missing?'Музыка не найдена: public/audio/(relax|music|ambient|track)':'Не удалось включить звук: проверьте MP3/OGG и звук вкладки.',3600);
    return false;
  }
}

async function toggleMusic() {
  if(musicPlaying) {
    music.pause();musicPlaying=false;musicWanted=false;
    ui.setMusic(false);ui.setMusicStatus('Музыка выключена. Нажмите N для включения.');
  } else {
    musicWanted=true;
    await startMusic(true);
  }
  saveElapsed=15;
}

function requestGameLock() {
  if (!initialized) return;
  if (document.pointerLockElement === renderer.domElement) {
    ui.showPlay();
    return;
  }
  // play() и Pointer Lock инициируются из одного пользовательского клика.
  if(musicWanted && !musicPlaying) void startMusic(false);
  const promise = renderer.domElement.requestPointerLock();
  if (promise?.catch) promise.catch((e) => {
    console.warn('PointerLock:', e);
    ui.showPause();
    ui.toast('Для управления мышью нужно разрешить захват курсора');
  });
}

/** Сначала переключаем UI в режим карты, только потом освобождаем мышь.
 * Благодаря этому pointerlockchange не вызывает меню паузы.
 */
function openWorldMap() {
  if (ui.mode !== 'play' || !worldMap) return;
  keys.clear(); mouse.left = mouse.right = false;
  miningProgress = 0;
  worldMap.activate(player);
  ui.showMap();
  if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
}

function closeWorldMap() {
  if (ui.mode !== 'map') return;
  // Промежуточный режим не показывает паузу, пока браузер возвращает Pointer Lock.
  ui.startMapClose();
  requestGameLock();
}

function resetWorld() {
  if (window.confirm('Удалить сохранение и создать новый мир? Это действие нельзя отменить.')) {
    localStorage.removeItem(SAVE_KEY);
    window.location.reload();
  }
}

function applyGraphicsSettings() {
  if (!renderer || !camera || !env) return;
  const g=graphicSettings;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5)*g.resolution);
  renderer.toneMappingExposure=g.exposure;
  camera.fov=g.fov;camera.updateProjectionMatrix();
  env.setFog(g.fog);
  env.setViewDistance(g.viewDistance);
  env.setShadows(g.shadows);
  clouds.setQuality(g.clouds);clouds.setSpeed(g.cloudSpeed);
  terrainMaterials.forEach((material,i)=>{
    const strength=g.normalStrength*(i<=1?1.08:1);
    material.normalScale.set(strength,strength);
  });
  settingsGI=g.ssgi;
  lighting.setEnabled(settingsGI);
  ui.setGI(lighting.isWebGPU && !lighting.faulted,lighting.enabled);
  world.replanStreaming(player.position,g.viewDistance,true);
  ui.setGraphics(g);
  saveElapsed=15;
}

function setGI(requested) {
  graphicSettings=graphicsChange(graphicSettings,'ssgi',requested);
  applyGraphicsSettings();
  if(requested && !lighting.enabled) ui.toast('SSGI недоступен на этом графическом устройстве');
}
function setGraphicsPreset(name) {
  if(name==='custom')return;
  graphicSettings=graphicsPreset(name,graphicSettings);
  applyGraphicsSettings();
}
function setGraphicsChange(key,value) {
  graphicSettings=graphicsChange(graphicSettings,key,value);
  applyGraphicsSettings();
}

function setupInput() {
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === renderer.domElement;
    if (locked) {
      ui.showPlay();
    } else if (ui.mode === 'play') {
      keys.clear();
      mouse.left = false;
      mouse.right = false;
      miningProgress = 0;
      ui.showPause();
      saveGame();
    }
  });

  document.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === renderer.domElement && ui.mode === 'play') {
      player.look(event.movementX, event.movementY);
    }
  });

  renderer.domElement.addEventListener('mousedown', (event) => {
    if (ui.mode !== 'play') return;
    event.preventDefault();
    if (event.button === 0) {
      mouse.left = true;
      mineSwingTimer = 0;
      ui.swingPickaxe();
    }
    if (event.button === 2) {
      mouse.right = true;
      rightRepeat = 0;
      placeBlock();
    }
  });
  document.addEventListener('mouseup', (event) => {
    if (event.button === 0) { mouse.left = false; miningProgress = 0; miningTargetKey = ''; }
    if (event.button === 2) mouse.right = false;
  });
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' || (event.code === 'Tab' && ui.mode === 'play')) event.preventDefault();
    if (ui.mode === 'map') {
      if ((event.code === 'KeyM' || event.code === 'Escape') && !event.repeat) {
        event.preventDefault();
        closeWorldMap();
      }
      return;
    }
    if (event.code === 'KeyE' && !event.repeat) {
      event.preventDefault();
      mouse.left = false; mouse.right = false; miningProgress = 0;
      if (ui.mode === 'inventory') ui.closeInventory();
      else if (ui.mode === 'play' || ui.mode === 'pause') ui.openInventory();
      return;
    }
    if (event.code === 'Escape' && ui.mode === 'inventory') {
      event.preventDefault();
      ui.closeInventory();
      return;
    }
    if (ui.mode !== 'play') return;
    keys.add(event.code);
    if (event.code === 'Space' && !event.repeat) player.queueJump();
    if (/^Digit[1-9]$/.test(event.code) && !event.repeat) ui.setSelected(Number(event.code.at(-1)) - 1);
    if (event.code === 'KeyQ' && !event.repeat) {
      camera.getWorldDirection(direction);
      if (drops.throwFrom(ui.selected, event.ctrlKey, camera.position, direction)) {
        ui.toast(event.ctrlKey ? 'Выброшена стопка блоков' : 'Выброшен один блок', 1250);
      }
    }
    if (event.code === 'KeyM' && !event.repeat) openWorldMap();
    if (event.code === 'KeyN' && !event.repeat) toggleMusic();
    if (event.code === 'KeyF' && !event.repeat) {
      flashlightEnabled=!flashlightEnabled;
      if(flashlight) flashlight.visible=flashlightEnabled;
      ui.toast(flashlightEnabled?'Фонарик включён (F)':'Фонарик выключен (F)',1200);
    }
  });
  document.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => { keys.clear(); mouse.left = false; mouse.right = false; });

  renderer.domElement.addEventListener('wheel', (event) => {
    if (ui.mode !== 'play') return;
    event.preventDefault();
    ui.setSelected(ui.selected + (event.deltaY > 0 ? 1 : -1));
  }, { passive: false });
  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', () => saveGame());
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });
}

function resize() {
  if (!renderer || !camera) return;
  camera.aspect = Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function targetUnderCrosshair() {
  camera.getWorldDirection(direction);
  return world.raycast(camera.position, direction, 5.75);
}

function placeBlock() {
  if (ui.mode !== 'play') return;
  const target = targetUnderCrosshair();
  if (!target) return;
  const selected = inventory.get(ui.selected);
  if (!selected || !selected.count) {
    ui.toast('Выберите стопку земли на панели быстрого доступа', 1400);
    return;
  }
  const x = target.x + target.normal.x;
  const y = target.y + target.normal.y;
  const z = target.z + target.normal.z;
  if (world.hasBlock(x, y, z) || player.intersectsBlock(x, y, z)) return;
  if (world.setBlock(x, y, z, BLOCK_ITEMS[selected.id].block)) {
    inventory.take(ui.selected, 1);
    fx.spawn(x, y, z, 4);
    saveElapsed = 12;
  }
}

function breakBlock(target) {
  const item=BLOCK_ITEM_BY_TYPE[world.getBlock(target.x,target.y,target.z)];
  if (!item || !world.setBlock(target.x,target.y,target.z,0)) return;
  const added=inventory.add(item,1);
  if(added!==1) {
    drops.spawnAt(target.x+0.5,target.y+0.55,target.z+0.5,1,item);
    ui.toast('Инвентарь заполнен — блок остался лежать на земле', 1500);
  }
  fx.spawn(target.x, target.y, target.z, 22);
  ui.swingPickaxe();
  saveElapsed = 12;
}

function stepInteraction(dt) {
  selectedTarget = targetUnderCrosshair();
  let canPlace = false;
  if (selectedTarget) {
    const { x, y, z, normal } = selectedTarget;
    canPlace = Boolean(inventory.get(ui.selected) && !player.intersectsBlock(x + normal.x, y + normal.y, z + normal.z) &&
      !world.hasBlock(x + normal.x, y + normal.y, z + normal.z));
  }
  fx.setTarget(selectedTarget, canPlace);
  if (mouse.left && selectedTarget) {
    const k = `${selectedTarget.x},${selectedTarget.y},${selectedTarget.z}`;
    if (k !== miningTargetKey) { miningTargetKey = k; miningProgress = 0; }
    miningProgress += dt / 0.48;
    mineSwingTimer += dt;
    if (mineSwingTimer > 0.37) { mineSwingTimer = 0; ui.swingPickaxe(); }
    ui.setToolWorking(true);
    if (miningProgress >= 1) {
      breakBlock(selectedTarget);
      miningProgress = 0;
      miningTargetKey = '';
    }
  } else {
    miningProgress = 0;
    miningTargetKey = '';
    ui.setToolWorking(false);
  }
  if (mouse.right) {
    rightRepeat += dt;
    if (rightRepeat >= 0.25) { rightRepeat = 0; placeBlock(); }
  }
  ui.setTarget(selectedTarget, miningProgress);
}

function tick(t) {
  const dt = lastTime ? Math.min(0.065, (t - lastTime) / 1000) : 0.016;
  lastTime = t;
  const playing = ui.mode === 'play';
  if (worldMap) worldMap.update(dt, player, ui.mode === 'map');
  player.update(dt, keys, playing);
  lightSampleTime+=dt;
  if(lightSampleTime>=0.35) {
    lightSampleTime=0;
    skyExposureAtPlayer=world.skyExposure(Math.floor(camera.position.x),Math.floor(camera.position.y),Math.floor(camera.position.z));
  }
  env.update(dt,skyExposureAtPlayer);
  clouds.update(dt);
  visibilityTime+=dt;
  if(visibilityTime>=0.85){visibilityTime=0;world.replanStreaming(player.position,graphicSettings.viewDistance);}
  world.processStreaming(2,1);
  if(flashlight && flashlightTarget){
    camera.getWorldDirection(direction);
    flashlight.position.copy(camera.position);
    flashlightTarget.position.copy(camera.position).addScaledVector(direction,10);
    flashlight.target.updateMatrixWorld();
    flashlight.intensity=flashlightEnabled ? (skyExposureAtPlayer<0.55 ? 8.2 : 5.3) : 0;
  }
  fx.update(dt);
  if (playing) {
    stepInteraction(dt);
    drops.update(dt, player);
    saveElapsed += dt;
    if (saveElapsed >= 15) { saveElapsed = 0; saveGame(); }
  } else {
    fx.setTarget(null);
    ui.setTarget(null);
    ui.setToolWorking(false);
  }
  lighting.render();
  if (lighting.faulted && ui.giInput.checked) {
    ui.setGI(false, false);
    ui.toast('SSGI отключено после ошибки графического драйвера');
  }
  fpsCounter++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fpsValue = fpsCounter / fpsTime;
    fpsCounter = 0;
    fpsTime = 0;
    ui.setStats(player, fpsValue,world.getStreamStats());
  }
}

async function start() {
  const saved = readSave();
  inventory = new Inventory(saved?.inventory);
  graphicSettings=migrateGraphicsSettings(saved?.graphics || {...GRAPHICS_DEFAULTS,ssgi:saved?.giEnabled!==false},saved?.graphicsSchema??0);
  settingsGI=graphicSettings.ssgi;
  musicWanted=saved?.musicEnabled!==false;
  musicVolume = Number.isFinite(saved?.musicVolume) ? Math.max(0, Math.min(1, saved.musicVolume)) : 0.3;
  music.volume = musicVolume;
  ui = new UI(inventory, {
    onResume: requestGameLock,
    onNew: resetWorld,
    onSave: () => saveGame(true),
    onMusicToggle: toggleMusic,
    onVolume: (v) => { musicVolume = v; music.volume = v; saveElapsed = 15; },
    onGIToggle: setGI,
    onGraphicsPreset:setGraphicsPreset,
    onGraphicsChange:setGraphicsChange,
    onMapClose: closeWorldMap,
    onMapZoom: delta => worldMap?.zoom(delta),
    onMapLevel: level => worldMap?.setLevel(level)
  }, Boolean(saved));
  ui.setVolume(musicVolume);
  ui.setGraphics(graphicSettings);
  ui.setSelected(saved?.selected ?? 0);

  try {
    const scene = new THREE.Scene();
    scene.background = null;
    camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.08, 2600);
    renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = graphicSettings.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.appendChild(renderer.domElement);
    await renderer.init();

    const isWebGPU = renderer.backend?.isWebGPUBackend === true;
    ui.setBackend(isWebGPU);
    console.info(`VERDANT: renderer WebGPURenderer, backend ${isWebGPU ? 'WebGPU' : 'WebGL2 fallback'}`);
    const { materials, missing, normalLoaded } = await loadMaterials();
    terrainMaterials=materials;
    world = new VoxelWorld(scene, materials, saved?.edits);
    player = new Player(world, camera, saved?.player);
    worldMap = new WorldMap(document.getElementById('map-canvas'), world);
    world.buildInitial(player.position,graphicSettings.viewDistance);
    env = new Environment(scene, camera);
    clouds=new Clouds(scene,camera,env.direction);
    flashlight=new THREE.SpotLight('#eef4ff',0,24,Math.PI/6,0.33,1.35);
    flashlight.castShadow=false;
    flashlight.visible=false;
    flashlightTarget=new THREE.Object3D();
    scene.add(flashlight,flashlightTarget);
    flashlight.target=flashlightTarget;
    fx = new Effects(scene);
    drops = new Drops(scene, world, inventory, saved?.drops);
    lighting = new Lighting(renderer, scene, camera);
    applyGraphicsSettings();
    ui.setTextures(normalLoaded, terrainMaterials.length);
    if (missing || normalLoaded!==terrainMaterials.length) {
      ui.toast(`Текстуры: ${terrainMaterials.length-missing}/${terrainMaterials.length}, нормали: ${normalLoaded}/${terrainMaterials.length}. Проверьте ZIP контента.`,7000);
    }
    if (player.recoveredFromSave) {
      console.warn('VERDANT: исправлена устаревшая позиция персонажа внутри грунта.');
      ui.toast('Персонаж извлечён из земли: ошибка старого сохранения исправлена', 5200);
    }
    initialized = true;
    setupInput();
    env.update(0,1);
    ui.setStats(player,0,world.getStreamStats());
    void checkMusicFile();
    renderer.setAnimationLoop(tick);
  } catch (error) {
    console.error('VERDANT: ошибка инициализации:', error);
    ui.fatal(error);
  }
}

start();

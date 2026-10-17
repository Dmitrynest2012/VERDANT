/**
 * VERDANT: единица сетки равна одному метру.
 * Горизонталь текущего мира: X/Z ∈ [-1000; +999] = 2×2 км.
 * Глубина уже сейчас закладывается до -1000 м, чтобы архитектура не зависела
 * от маленькой демозоны и могла расти дальше без сплошных 3D-массивов.
 */
export const WORLD_HALF = 1000;
export const CHUNK_SIZE = 16;
export const SECTION_HEIGHT = 16;
export const MIN_WORLD_Y = -1000;
export const MAX_WORLD_Y = 50;
export const SEED = 170621;
export const MIN_CHUNK = Math.floor(-WORLD_HALF / CHUNK_SIZE);
export const MAX_CHUNK = Math.floor((WORLD_HALF - 1) / CHUNK_SIZE);
export const MIN_SECTION = Math.floor(MIN_WORLD_Y / SECTION_HEIGHT);
export const MAX_SECTION = Math.floor(MAX_WORLD_Y / SECTION_HEIGHT);

export const BLOCK = Object.freeze({AIR:0,GRASS:1,DIRT:2,ROCKY_DIRT:3,COMPACT_EARTH:4,SHALE:5,DEEP_STONE:6,WATER:7});
export const BLOCK_ITEMS = Object.freeze({
  grass: { block: BLOCK.GRASS, title: 'Зелёная земля' },
  dirt: { block: BLOCK.DIRT, title: 'Земля' },
  rocky_dirt: { block: BLOCK.ROCKY_DIRT, title: 'Земля с камнями' },
  compact_earth: { block: BLOCK.COMPACT_EARTH, title: 'Плотная земля' },
  shale: { block: BLOCK.SHALE, title: 'Сланцевая порода' },
  deep_stone: { block: BLOCK.DEEP_STONE, title: 'Глубинная порода' },
  bucket: { title: 'Пустое ведро', tool: 'bucket', stackMax: 1 },
  water_bucket: { title: 'Ведро воды', tool: 'bucket', stackMax: 1 }
});
export const BLOCK_ITEM_BY_TYPE = Object.freeze({1:'grass',2:'dirt',3:'rocky_dirt',4:'compact_earth',5:'shale',6:'deep_stone',7:'water'});
function hash(x, z, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(x, z, scale, seed) {
  const fx = x / scale, fz = z / scale;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const u = tx * tx * (3 - 2 * tx), v = tz * tz * (3 - 2 * tz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
export function insideHorizontal(x, z) {return x >= -WORLD_HALF && x < WORLD_HALF && z >= -WORLD_HALF && z < WORLD_HALF;}
/** Генератор 1 сохраняется неизменным; генератор 2 использует SurfaceHydrology. */
export function terrainHeight(x, z, seed = SEED) {
  if (!insideHorizontal(x, z)) return MIN_WORLD_Y - 1;
  const broad = (valueNoise(x, z, 37, seed) - 0.5) * 10;
  const medium = (valueNoise(x, z, 15, seed + 1) - 0.5) * 5;
  const fine = (valueNoise(x, z, 6, seed + 2) - 0.5) * 1.8;
  let h = Math.round(8 + broad + medium + fine);
  const r = Math.hypot(x, z);
  if (r < 11) {
    const t = Math.min(1, Math.max(0, (r - 6) / 5));
    const smooth = t * t * (3 - 2 * t);
    h = Math.round(8 * (1 - smooth) + h * smooth);
  }
  return Math.max(MIN_WORLD_Y + 8, Math.min(MAX_WORLD_Y - 2, h));
}
export function rockStartDepth(x,z,seed=SEED) {return 4+Math.floor(hash(x,z,seed+912)*4);}
export function compactStartDepth(x,z,seed=SEED) {return 14+Math.floor(hash(x,z,seed+131)*10);}
export function shaleStartDepth(x,z,seed=SEED) {return 52+Math.floor(hash(x,z,seed+533)*28);}
export function deepStoneStartDepth(x,z,seed=SEED) {return 190+Math.floor(hash(x,z,seed+811)*150);}
/** Геологические границы задаются глубиной от локальной поверхности. */
export function naturalBlock(x, y, z, seed = SEED, height = terrainHeight(x, z, seed)) {
  if (!insideHorizontal(x, z) || y < MIN_WORLD_Y || y > MAX_WORLD_Y || y > height) return BLOCK.AIR;
  const depth = height - y;
  if (depth === 0) return BLOCK.GRASS;
  if (depth < rockStartDepth(x, z, seed)) return BLOCK.DIRT;
  if (depth < compactStartDepth(x, z, seed)) return BLOCK.ROCKY_DIRT;
  if (depth < shaleStartDepth(x, z, seed)) return BLOCK.COMPACT_EARTH;
  if (depth < deepStoneStartDepth(x, z, seed)) return BLOCK.SHALE;
  return BLOCK.DEEP_STONE;
}
export function blockKey(x,y,z) {return `${x},${y},${z}`;}
export function columnKey(x,z) {return `${x},${z}`;}
export function sectionKey(cx,cy,cz) {return `${cx},${cy},${cz}`;}
/** Крупномасштабная плавная окраска травы. */
export function grassTintAt(x, z, seed = SEED) {
  const a = valueNoise(x, z, 18, seed + 41) - 0.5;
  const b = valueNoise(x, z, 57, seed + 89) - 0.5;
  const c = valueNoise(x, z, 161, seed + 113) - 0.5;
  const shade = 0.965 + 0.040 * a + 0.026 * b + 0.018 * c;
  return {r:shade*(0.970+0.020*b),g:shade*(1.000+0.015*a),b:shade*(0.955+0.022*c)};
}
export function textureOrientation(x,y,z,seed=SEED) {
  const gx=Math.floor(x/2),gy=Math.floor(y/2),gz=Math.floor(z/2);
  const k=(Math.imul(gx,73856093)^Math.imul(gy,19349663)^Math.imul(gz,83492791)^seed)>>>0;
  return k%8;
}
/** Зелёная кромка боковой грани всегда сверху. */
export function orientedFaceUV(u,v,orientation,type,faceKind) {
  if(type===BLOCK.GRASS && faceKind===1)return [u,v];
  return orientedUV(u,v,orientation);
}
export function orientedUV(u,v,orientation) {
  if(orientation&4)u=1-u;
  for(let i=0;i<(orientation&3);i++){const q=u;u=v;v=1-q;}
  return [u,v];
}

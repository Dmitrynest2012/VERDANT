import { terrainHeight, insideHorizontal, MIN_WORLD_Y, SEED } from './Terrain.js';

export const TERRAIN_VERSION = 2;
export const LAKE_CELL_SIZE = 224;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
function hash(x, z, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Детерминированные замкнутые поверхностные чаши. Подземных источников нет. */
export class SurfaceHydrology {
  constructor(seed = SEED, version = TERRAIN_VERSION) {
    this.seed = seed;
    this.version = version;
    this.lakes = new Map();
    this.home = version >= 2 ? this.describe(48, -32, 22, 17, 4, 'home') : null;
  }
  describe(x, z, rx, rz, depth, id) {
    // Вода НИЖЕ самой низкой точки берега: чаша не висит над долиной.
    let low = Infinity;
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12;
      low = Math.min(low, terrainHeight(Math.floor(x + Math.cos(a) * rx * 1.13),
        Math.floor(z + Math.sin(a) * rz * 1.13), this.seed));
    }
    return { x, z, rx, rz, depth, waterY: low - 1, id };
  }
  lake(cx, cz) {
    const key = `${cx},${cz}`;
    if (this.lakes.has(key)) return this.lakes.get(key);
    const h = n => hash(cx, cz, this.seed + n);
    let value = null;
    if (h(331) < .74) {
      const x = cx * LAKE_CELL_SIZE + 62 + h(733) * 100;
      const z = cz * LAKE_CELL_SIZE + 62 + h(917) * 100;
      // Не затрагиваем стартовую поляну и учебный водоём.
      if (Math.hypot(x, z) > 110 && Math.hypot(x-48,z+32)>90 && insideHorizontal(x - 55, z - 55) && insideHorizontal(x + 55, z + 55)) {
        const r = 7 + Math.pow(h(72), 1.3) * 35;
        value = this.describe(x, z, r, r * (.65 + h(93) * .4), 2 + Math.floor(h(21) * 7), key);
      }
    }
    this.lakes.set(key, value);
    return value;
  }
  /** Верхний твёрдый блок, а не поверхность жидкости. Работает с отрицательным X/Z. */
  column(x, z) {
    const original = terrainHeight(x, z, this.seed);
    if (this.version < 2 || !insideHorizontal(x, z)) return { height: original, waterY: null };
    const cx = Math.floor(x / LAKE_CELL_SIZE), cz = Math.floor(z / LAKE_CELL_SIZE);
    const near = this.home && Math.abs(x - this.home.x) < 34 && Math.abs(z - this.home.z) < 28 ? this.home : this.lake(cx, cz);
    if (!near) return { height: original, waterY: null };
    const dx = (x + .5 - near.x) / near.rx, dz = (z + .5 - near.z) / near.rz;
    const angle = Math.atan2(dz, dx);
    const q = Math.hypot(dx, dz) / (1 + .045 * Math.sin(angle * 3 + this.seed) + .025 * Math.sin(angle * 7));
    if (q >= 1.23) return { height: original, waterY: null };
    if (q >= 1) {
      // Непрерывная береговая полоса всегда удерживает воду на своём уровне.
      const bank = Math.max(near.waterY, original);
      const height = Math.max(near.waterY, Math.round(near.waterY + (bank - near.waterY) * ease((q - 1) / .23)));
      return { height, waterY: null };
    }
    const height = Math.max(MIN_WORLD_Y + 2, near.waterY - 1 - Math.floor(near.depth * (1 - q * q)));
    return { height, waterY: near.waterY, lakeId: near.id };
  }
}

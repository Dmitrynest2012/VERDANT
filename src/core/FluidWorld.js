import { CHUNK_SIZE, MIN_WORLD_Y, MAX_WORLD_Y, WORLD_HALF, blockKey } from './Terrain.js';

/** Вода хранится ОТДЕЛЬНО от твёрдых блоков: она не является коллайдером. */
export const WATER = Object.freeze({ NONE: 0, SOURCE: 8, FALLING: 9 });
export const WATER_TICK = .1;
export const MAX_FLUID_EDITS = 300000;
const SIDES = [[1,0],[-1,0],[0,1],[0,-1]];
const NEIGHBOURS = [[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const section = (x,y,z) => `${Math.floor(x/16)},${Math.floor(y/16)},${Math.floor(z/16)}`;
export function fluidHeight(value) { return value === 9 ? 1 : value / 9; }
export function validFluidPosition(x,y,z) {
  return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) &&
    x >= -WORLD_HALF && x < WORLD_HALF && z >= -WORLD_HALF && z < WORLD_HALF && y >= MIN_WORLD_Y && y <= MAX_WORLD_Y;
}

export class FluidWorld {
  constructor(world, saved = null) {
    this.world = world;
    this.edits = new Map();
    this.bySection = new Map(); this.byColumn = new Map();
    this.queue = []; this.head = 0; this.scheduled = new Set(); this.sleeping = new Map();
    this.dirty = new Set(); this.revision = 0; this.accumulator = 0; this.wakeTimer = 0;
    for (const [key,value] of Object.entries(saved?.edits || {}).slice(0, MAX_FLUID_EDITS)) {
      const [x,y,z] = key.split(',').map(Number);
      if (validFluidPosition(x,y,z) && Number.isInteger(value) && value >= 0 && value <= 9) {
        this.store(x,y,z,value); this.enqueueAround(x,y,z);
      }
    }
  }
  natural(x,y,z) {
    const col = this.world.surfaceColumn(x,z);
    return col.waterY !== null && y > col.height && y <= col.waterY ? WATER.SOURCE : 0;
  }
  get(x,y,z) {
    if (!validFluidPosition(x,y,z) || this.world.hasBlock(x,y,z)) return 0;
    const key = blockKey(x,y,z);
    return this.edits.has(key) ? this.edits.get(key) : this.natural(x,y,z);
  }
  store(x,y,z,value) {
    const key = blockKey(x,y,z), s = section(x,y,z);
    this.edits.set(key,value);
    let entries = this.bySection.get(s);
    if (!entries) { entries = new Set(); this.bySection.set(s,entries); }
    entries.add(key);
    const c=`${x},${z}`;if(!this.byColumn.has(c))this.byColumn.set(c,new Map());this.byColumn.get(c).set(y,value);
  }
  write(x,y,z,value) {
    const key = blockKey(x,y,z);
    if (!this.edits.has(key) && this.edits.size >= MAX_FLUID_EDITS) return false;
    if (value === this.natural(x,y,z)) {
      this.edits.delete(key); this.bySection.get(section(x,y,z))?.delete(key);this.byColumn.get(`${x},${z}`)?.delete(y);
    } else this.store(x,y,z,value);
    this.revision++;
    for (const [dx,dy,dz] of NEIGHBOURS) this.dirty.add(section(x+dx,y+dy,z+dz));
    this.enqueueAround(x,y,z);
    return true;
  }
  enqueue(x,y,z) {
    if (!validFluidPosition(x,y,z)) return;
    const key = blockKey(x,y,z);
    if (!this.scheduled.has(key)) { this.scheduled.add(key); this.queue.push([x,y,z]); }
  }
  enqueueAround(x,y,z) { for (const [dx,dy,dz] of NEIGHBOURS) this.enqueue(x+dx,y+dy,z+dz); }
  setSource(x,y,z) {
    if (!validFluidPosition(x,y,z) || this.world.hasBlock(x,y,z) || this.get(x,y,z) === WATER.SOURCE) return false;
    return this.write(x,y,z,WATER.SOURCE);
  }
  takeSource(x,y,z) {
    if (this.get(x,y,z) !== WATER.SOURCE) return false;
    return this.write(x,y,z,0);
  }
  solidChanged(x,y,z) {
    // Заполнение водой не меняет блоки и не обновляет тяжёлые грунтовые меши.
    if (this.world.hasBlock(x,y,z)) {
      if (this.edits.has(blockKey(x,y,z)) || this.natural(x,y,z)) this.write(x,y,z,0);
    }
    for (const [dx,dy,dz] of NEIGHBOURS) this.dirty.add(section(x+dx,y+dy,z+dz));
    this.enqueueAround(x,y,z);
    this.revision++;
  }
  supported(x,y,z) { return y === MIN_WORLD_Y || this.world.hasBlock(x,y-1,z) || this.get(x,y-1,z) === WATER.SOURCE; }
  desired(x,y,z) {
    if (this.world.hasBlock(x,y,z)) return 0;
    const current = this.get(x,y,z);
    if (current === WATER.SOURCE) return current;
    const values = SIDES.map(([dx,dz])=>this.get(x+dx,y,z+dz));
    // Возобновляемый источник как в небольшой квадратной чаше: 2 соседа + опора.
    if (values.filter(v=>v===WATER.SOURCE).length >= 2 && this.supported(x,y,z)) return WATER.SOURCE;
    if (this.get(x,y+1,z)) return WATER.FALLING;
    let best = 0;
    SIDES.forEach(([dx,dz],i)=>{
      if (values[i] && this.supported(x+dx,y,z+dz)) best = Math.max(best, Math.min(8,values[i]) - 1);
    });
    return best;
  }
  /** Один логический шаг. Новые соседи обрабатываются на СЛЕДУЮЩЕМ шаге. */
  tick(center = {x:0,y:0,z:0}, budget = 1200, timeBudgetMs = 2.5) {
    const limit = Math.min(this.queue.length, this.head + budget), start = performance.now();
    let count = 0;
    while (this.head < limit) {
      if (count && (count & 31) === 0 && performance.now() - start > timeBudgetMs) break;
      const [x,y,z] = this.queue[this.head++], key = blockKey(x,y,z);
      this.scheduled.delete(key);
      if (Math.abs(x-center.x)>112 || Math.abs(z-center.z)>112 || Math.abs(y-center.y)>64) {
        const id = section(x,y,z);
        let cells = this.sleeping.get(id);
        if (!cells) { cells = new Map(); this.sleeping.set(id,cells); }
        cells.set(key,[x,y,z]); continue;
      }
      const before = this.get(x,y,z), after = this.desired(x,y,z);
      if (before !== after) this.write(x,y,z,after);
      count++;
    }
    if (this.head > 4096 || this.head === this.queue.length) { this.queue = this.queue.slice(this.head); this.head = 0; }
    return count;
  }
  update(dt,center,active=true) {
    if (!active) return;
    this.wakeTimer += dt;
    if (this.wakeTimer >= .5) {
      this.wakeTimer = 0;
      for (const [key,cells] of this.sleeping) {
        const [cx,cy,cz] = key.split(',').map(Number);
        if (Math.abs(cx*16+8-center.x)<104 && Math.abs(cz*16+8-center.z)<104 && Math.abs(cy*16+8-center.y)<56) {
          for (const p of cells.values()) this.enqueue(...p);
          this.sleeping.delete(key);
        }
      }
    }
    this.accumulator += Math.min(dt,.1);
    if (this.accumulator >= WATER_TICK) { this.accumulator %= WATER_TICK; this.tick(center); }
  }
  pointDepth(x,y,z) {
    const bx=Math.floor(x), by=Math.floor(y), bz=Math.floor(z), value=this.get(bx,by,bz);
    if (!value) return 0;
    let top=by+fluidHeight(value);
    for(let n=1;n<=24 && this.get(bx,by+n,bz);n++) top=by+n+fluidHeight(this.get(bx,by+n,bz));
    return Math.max(0,top-y);
  }
  surface(x,z,ground) {
    // Для карты: столбец озера либо немного выше/ниже изменённого грунта.
    const col=this.world.surfaceColumn(x,z);
    let top = col.waterY ?? ground;
    const edits=this.byColumn.get(`${x},${z}`);
    if(edits)for(const [y,value] of edits)if(value>0)top=Math.max(top,y);
    for(let y=top;y>ground && y>=MIN_WORLD_Y;y--) if(this.get(x,y,z)) return y+fluidHeight(this.get(x,y,z));
    return null;
  }
  toJSON() { return { version:1, edits:Object.fromEntries(this.edits) }; }
}

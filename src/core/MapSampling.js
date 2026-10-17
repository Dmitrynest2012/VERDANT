import { BLOCK, MIN_WORLD_Y, insideHorizontal } from './Terrain.js';

/** Канонические диаметры окна карты: 200, 400, 800, 1600 метров. */
export const MAP_DIAMETERS = Object.freeze([200, 400, 800, 1600]);
export const MAP_PIXEL_SIZE = 384;

export function clampMapLevel(index) {
  return Math.min(MAP_DIAMETERS.length - 1, Math.max(0, Math.round(Number.isFinite(index) ? index : 0)));
}

export function mapWorldPosition(pixelX, pixelZ, pixels, centerX, centerZ, diameter) {
  const scale = diameter / pixels;
  return {
    x: centerX + (pixelX + 0.5 - pixels / 2) * scale,
    z: centerZ + (pixelZ + 0.5 - pixels / 2) * scale
  };
}

function clampByte(value) { return Math.max(0, Math.min(255, Math.round(value))); }
function fract(v) { return v - Math.floor(v); }

const MATERIAL_PALETTE = Object.freeze({
  [BLOCK.GRASS]: [84, 141, 64],
  [BLOCK.DIRT]: [120, 91, 66],
  [BLOCK.ROCKY_DIRT]: [122, 111, 93],
  [BLOCK.COMPACT_EARTH]: [105, 88, 68],
  [BLOCK.SHALE]: [87, 96, 106],
  [BLOCK.DEEP_STONE]: [72, 78, 88]
});

/** Карта читает реальную воксельную высоту, включая выкопанные/поставленные блоки. */
export function sampleMapPixel(world, x, z, scale = 1) {
  if (!insideHorizontal(x, z)) return [55, 103, 138, 255];
  const bx = Math.floor(x), bz = Math.floor(z);
  const y = world.highestSolid(bx, bz);
  if (y < MIN_WORLD_Y) return [25, 53, 63, 255];
  const waterTop=world.water?.surface(bx,bz,y);
  if(waterTop!=null) {
    const depth=Math.min(10,Math.max(.2,waterTop-y-1));
    return [Math.round(58-depth*2),Math.round(151-depth*6),Math.round(182-depth*5),255];
  }
  const block = world.getBlock(bx, y, bz);
  const palette = MATERIAL_PALETTE[block] || MATERIAL_PALETTE[BLOCK.DIRT];
  const west = world.heightSeed(Math.max(-1000, bx - 1), bz);
  const east = world.heightSeed(Math.min(999, bx + 1), bz);
  const north = world.heightSeed(bx, Math.max(-1000, bz - 1));
  const south = world.heightSeed(bx, Math.min(999, bz + 1));
  const slope = (west - east) * 0.18 + (north - south) * 0.12;
  const elevation = Math.min(0.13, Math.max(-0.12, (y - 8) * 0.012));
  const detail = (fract(Math.sin(bx * 32.117 + bz * 57.43) * 43758.5453) - 0.5) * 0.14;
  const excavation = y < world.heightSeed(bx, bz) ? -0.22 : 0;
  const shade = Math.max(0.43, Math.min(1.34, 1 + slope + elevation + detail + excavation));
  return [clampByte(palette[0] * shade),clampByte(palette[1] * shade),clampByte(palette[2] * shade),255];
}

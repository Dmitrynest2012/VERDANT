import { CHUNK_SIZE, WORLD_HALF, MIN_CHUNK, MAX_CHUNK } from './Terrain.js';

export const FAR_TILE_SIZE = 128;
export const STREAM_DEFAULT_DISTANCE = 200;

/** Не допускаем безлимитного количества полных 16³ мешей при выборе 1 км. */
export function nearDetailRadius(drawDistance) {
  return Math.min(112, Math.max(64, drawDistance * 0.46));
}

/** Минимальная дистанция от точки до квадрата — чтобы не терять углы тайлов. */
export function distanceToTile(x,z,tx,tz,tileSize=FAR_TILE_SIZE) {
  const nearestX=Math.max(tx*tileSize,Math.min(x,(tx+1)*tileSize));
  const nearestZ=Math.max(tz*tileSize,Math.min(z,(tz+1)*tileSize));
  return Math.hypot(x-nearestX,z-nearestZ);
}

/** Шаг сэмплирования далеко от игрока возрастает с расстоянием. */
export function farTileStep(distance) {
  return distance < 240 ? 4 : distance < 480 ? 8 : 16;
}

/** Чистое планирование без WebGPU: тестируется отдельно от геометрии. */
export function planTerrain(centerX,centerZ,drawDistance) {
  const radius=nearDetailRadius(drawDistance);
  const near=[],far=[];
  const r=Math.ceil((radius+CHUNK_SIZE*2)/CHUNK_SIZE);
  const cx0=Math.floor(centerX/CHUNK_SIZE),cz0=Math.floor(centerZ/CHUNK_SIZE);
  for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++) {
    const cx=cx0+dx,cz=cz0+dz;
    const x=(cx+.5)*CHUNK_SIZE,z=(cz+.5)*CHUNK_SIZE;
    if(cx<MIN_CHUNK || cx>MAX_CHUNK || cz<MIN_CHUNK || cz>MAX_CHUNK)continue;
    const dist=Math.hypot(x-centerX,z-centerZ);
    if(dist<=radius+CHUNK_SIZE*0.85)near.push({cx,cz,priority:dist});
  }
  near.sort((a,b)=>a.priority-b.priority);
  const fr=Math.ceil((drawDistance+FAR_TILE_SIZE*1.5)/FAR_TILE_SIZE);
  const tx0=Math.floor(centerX/FAR_TILE_SIZE),tz0=Math.floor(centerZ/FAR_TILE_SIZE);
  for(let dz=-fr;dz<=fr;dz++)for(let dx=-fr;dx<=fr;dx++) {
    const tx=tx0+dx,tz=tz0+dz;
    if(tx*FAR_TILE_SIZE>=WORLD_HALF || (tx+1)*FAR_TILE_SIZE<=-WORLD_HALF ||
       tz*FAR_TILE_SIZE>=WORLD_HALF || (tz+1)*FAR_TILE_SIZE<=-WORLD_HALF)continue;
    const nearest=distanceToTile(centerX,centerZ,tx,tz);
    if(nearest>drawDistance+16)continue;
    const dist=Math.hypot((tx+.5)*FAR_TILE_SIZE-centerX,(tz+.5)*FAR_TILE_SIZE-centerZ);
    far.push({tx,tz,step:farTileStep(dist),priority:nearest});
  }
  far.sort((a,b)=>a.priority-b.priority);
  return {near,far,radius};
}

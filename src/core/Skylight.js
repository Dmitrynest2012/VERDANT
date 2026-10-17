import { MIN_WORLD_Y, MAX_WORLD_Y, insideHorizontal, blockKey } from './Terrain.js';

const DIRECTIONS=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const MAX_STEPS=11;

/**
 * Локальное диффузное освещение без кубического массива на весь мир.
 * Источник 1.0 — ячейка с открытым небом по вертикали. Подземный воздух
 * распространяет свет на ограниченное расстояние с экспоненциальным спадом.
 * Результаты сохраняются в кэше активной области и инвалидируются при копании.
 */
export function sampleSkylight(world,x,y,z,cache=new Map()) {
  if(world.hasBlock(x,y,z))return 0;
  if(!insideHorizontal(x,z)||y>world.highestSolid(x,z))return 1;
  const origin=blockKey(x,y,z);
  if(cache.has(origin))return cache.get(origin);
  const queue=[[x,y,z,0]],visited=new Set([origin]);
  let result=0;
  outer:for(let i=0;i<queue.length;i++) {
    const [cx,cy,cz,step]=queue[i];
    if(step>=MAX_STEPS)continue;
    for(const [dx,dy,dz] of DIRECTIONS) {
      const xx=cx+dx,yy=cy+dy,zz=cz+dz,d=step+1;
      if(yy<MIN_WORLD_Y||yy>MAX_WORLD_Y||world.hasBlock(xx,yy,zz))continue;
      if(!insideHorizontal(xx,zz)||yy>world.highestSolid(xx,zz)) {
        result=Math.exp(-0.45*d);
        break outer;
      }
      const key=blockKey(xx,yy,zz);
      if(!visited.has(key) && d<MAX_STEPS) {
        visited.add(key);
        queue.push([xx,yy,zz,d]);
      }
    }
  }
  if(cache.size>50000)cache.clear();
  cache.set(origin,result);
  return result;
}

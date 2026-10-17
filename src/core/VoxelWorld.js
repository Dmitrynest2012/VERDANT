import { VoxelWorld as VoxelTerrainBase } from './VoxelTerrainBase.js';
import { SurfaceHydrology } from './SurfaceHydrology.js';
import { FluidWorld } from './FluidWorld.js';
import { SEED, BLOCK, columnKey, naturalBlock } from './Terrain.js';

/** Генератор и жидкость расширяют проверенный потоковый рендер твёрдого мира.
 * Базовый класс не знает о воде: вода никогда не становится твёрдым коллайдером.
 */
export class VoxelWorld extends VoxelTerrainBase {
  constructor(scene,materials,savedEdits=null,seed=SEED,options={}) {
    super(scene,materials,savedEdits,seed);
    this.generatorVersion=options.generatorVersion ?? 1;
    this.hydrology=new SurfaceHydrology(seed,this.generatorVersion);
    this.columns=new Map();this.worldRevision=0;
    this.water=new FluidWorld(this,options.water);
    for(const key of this.edits.keys()) {
      const [x,y,z]=key.split(',').map(Number);this.water.enqueueAround(x,y,z);
    }
  }
  surfaceColumn(x,z) {
    const key=columnKey(x,z);
    if(!this.columns.has(key)) {
      if(this.columns.size>90000)this.columns.clear();
      this.columns.set(key,this.hydrology.column(x,z));
    }
    return this.columns.get(key);
  }
  heightSeed(x,z) {
    const col=columnKey(x,z);
    if(!this.heights.has(col)) {
      if(this.heights.size>85000)this.heights.clear();
      this.heights.set(col,this.surfaceColumn(x,z).height);
    }
    return this.heights.get(col);
  }
  baseBlock(x,y,z) {
    const value=naturalBlock(x,y,z,this.seed,this.heightSeed(x,z));
    return value===BLOCK.GRASS && this.surfaceColumn(x,z).waterY!==null ? BLOCK.DIRT : value;
  }
  setBlock(x,y,z,id) {
    const changed=super.setBlock(x,y,z,id);
    if(changed) {this.worldRevision++;this.water.solidChanged(x,y,z);}
    return changed;
  }
  raycast(origin,direction,maxDistance=6,includeWater=false) {
    if(!includeWater) return super.raycast(origin,direction,maxDistance);
    const ox=origin.x,oy=origin.y,oz=origin.z;
    const dx=direction.x,dy=direction.y,dz=direction.z;
    let x=Math.floor(ox),y=Math.floor(oy),z=Math.floor(oz);
    const sx=Math.sign(dx),sy=Math.sign(dy),sz=Math.sign(dz);
    const tx=dx?Math.abs(1/dx):Infinity,ty=dy?Math.abs(1/dy):Infinity,tz=dz?Math.abs(1/dz):Infinity;
    let nextX=sx>0?(x+1-ox)*tx:sx<0?(ox-x)*tx:Infinity;
    let nextY=sy>0?(y+1-oy)*ty:sy<0?(oy-y)*ty:Infinity;
    let nextZ=sz>0?(z+1-oz)*tz:sz<0?(oz-z)*tz:Infinity;
    let dist=0,nx=0,ny=0,nz=0;
    for(let i=0;i<160 && dist<=maxDistance;i++) {
      if(this.hasBlock(x,y,z)) return {x,y,z,type:this.getBlock(x,y,z),normal:{x:nx,y:ny,z:nz},distance:dist};
      if(includeWater && this.water.get(x,y,z)) return {x,y,z,type:BLOCK.WATER,fluid:this.water.get(x,y,z),normal:{x:nx,y:ny,z:nz},distance:dist};
      if(nextX<=nextY && nextX<=nextZ) {x+=sx;dist=nextX;nextX+=tx;nx=-sx;ny=0;nz=0;}
      else if(nextY<=nextZ) {y+=sy;dist=nextY;nextY+=ty;nx=0;ny=-sy;nz=0;}
      else {z+=sz;dist=nextZ;nextZ+=tz;nx=0;ny=0;nz=-sz;}
    }
    return null;
  }
}

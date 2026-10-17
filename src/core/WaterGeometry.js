import { MIN_WORLD_Y, MAX_WORLD_Y, insideHorizontal } from './Terrain.js';
import { fluidHeight } from './FluidWorld.js';

const SIDES=[{dx:1,dz:0,v:[[1,0,1],[1,0,0],[1,1,0],[1,1,1]]},
  {dx:-1,dz:0,v:[[0,0,0],[0,0,1],[0,1,1],[0,1,0]]},
  {dx:0,dz:1,v:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]]},
  {dx:0,dz:-1,v:[[1,0,0],[0,0,0],[0,1,0],[1,1,0]]}];
export function emptyWaterGeometry(){return {position:[],normal:[],uv:[],waterInfo:[],waveMask:[],index:[]};}
export function waterQuad(g,vertices,normal,depth,shore=0,top=1,waveMasks=null) {
  const start=g.position.length/3;
  for(let i=0;i<vertices.length;i++) {
    const v=vertices[i];
    g.position.push(...v);g.normal.push(...normal);
    // Боковая UV содержит Y, иначе тангенс вырождается в NaN.
    g.uv.push(top?v[0]:(normal[0]?v[2]:v[0]),top?v[2]:v[1]);
    g.waterInfo.push(Array.isArray(depth)?depth[i]:depth,Array.isArray(shore)?shore[i]:shore,top);
    g.waveMask.push(waveMasks?waveMasks[i]:top);
  }
  g.index.push(start,start+1,start+2,start,start+2,start+3);
}
function cornerHeight(water,x,y,z,ox,oz) {
  let sum=0,n=0;
  for(const dx of [ox-1,ox])for(const dz of [oz-1,oz]) {
    if(water.get(x+dx,y+1,z+dz))return 1;
    const v=water.get(x+dx,y,z+dz);
    if(v===8||v===9)return fluidHeight(v);
    if(v){sum+=fluidHeight(v);n++;}
  }
  return n?sum/n:0;
}
/** Видимые грани жидкости, без отдельных объектов на каждый водяной блок. */
export function buildWaterSection(world,cx,cy,cz) {
  const g=emptyWaterGeometry(),water=world.water;
  for(let x=cx*16;x<cx*16+16;x++)for(let z=cz*16;z<cz*16+16;z++) {
    if(!insideHorizontal(x,z))continue;
    const col=world.surfaceColumn(x,z);
    const edits=water.byColumn.get(`${x},${z}`);
    let minY=col.waterY==null?Infinity:col.height+1,maxY=col.waterY??-Infinity;
    if(edits)for(const [y,v] of edits)if(v>0){minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    for(let y=Math.max(MIN_WORLD_Y,cy*16,minY);y<=Math.min(MAX_WORLD_Y,cy*16+15,maxY);y++) {
      const v=water.get(x,y,z);if(!v)continue;
      const above=water.get(x,y+1,z),h=above?1:fluidHeight(v);
      const depth=Math.max(.2,Math.min(20,y-col.height));
      const shoreAt=(ox,oz)=>{
        for(const dx of [ox-1,ox])for(const dz of [oz-1,oz])if(world.hasBlock(x+dx,y,z+dz))return 1;
        return 0;
      };
      if(!above && !world.hasBlock(x,y+1,z)) {
        const points=[[0,1],[1,1],[1,0],[0,0]].map(([ox,oz])=>[x+ox,y+cornerHeight(water,x,y,z,ox,oz),z+oz]);
        waterQuad(g,points,[0,1,0],depth,[[0,1],[1,1],[1,0],[0,0]].map(([ox,oz])=>shoreAt(ox,oz)),1);
      }
      for(const s of SIDES) {
        if(world.hasBlock(x+s.dx,y,z+s.dz))continue;
        const neighbour=water.get(x+s.dx,y,z+s.dz);
        const bottom=neighbour?fluidHeight(neighbour):0;
        if(bottom>=h-.005)continue;
        waterQuad(g,s.v.map(([ox,oy,oz])=>[x+ox,y+(oy?(above?1:cornerHeight(water,x,y,z,ox,oz)):bottom),z+oz]),[s.dx,0,s.dz],depth,s.v.map(([ox,oy,oz])=>shoreAt(ox,oz)),0,above?[0,0,0,0]:[0,0,1,1]);
      }
    }
  }
  return g;
}

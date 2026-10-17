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
    const v=vertices[i];g.position.push(...v);g.normal.push(...normal);
    g.uv.push(top?v[0]:(normal[0]?v[2]:v[0]),top?v[2]:v[1]);
    g.waterInfo.push(Array.isArray(depth)?depth[i]:depth,Array.isArray(shore)?shore[i]:shore,top);
    g.waveMask.push(waveMasks?waveMasks[i]:top);
  }
  g.index.push(start,start+1,start+2,start,start+2,start+3);
}
/** Общая вершина четырёх клеток. Порядок выборки не зависит от текущей секции. */
export function waterCorner(world,gx,y,gz) {
  const water=world.water;let sum=0,weight=0,depth=0,count=0,solid=0,full=false;
  for(let x=gx-1;x<=gx;x++)for(let z=gz-1;z<=gz;z++) {
    if(world.hasBlock(x,y,z))solid++;
    if(water.get(x,y+1,z))full=true;
    const v=water.get(x,y,z);if(!v)continue;
    const w=v===8?10:1;sum+=fluidHeight(v)*w;weight+=w;
    if(v===9)full=true;
    depth+=Math.max(.2,Math.min(20,y-world.surfaceColumn(x,z).height));count++;
  }
  return {height:full?1:weight?sum/weight:0,depth:count?depth/count:.2,shore:Math.min(1,solid/2)};
}
/** Только внешняя оболочка жидкости. Между двумя мокрыми клетками стены запрещены. */
export function buildWaterSection(world,cx,cy,cz) {
  const g=emptyWaterGeometry(),water=world.water,corners=new Map();
  const corner=(gx,y,gz)=>{const key=`${gx},${y},${gz}`;if(!corners.has(key))corners.set(key,waterCorner(world,gx,y,gz));return corners.get(key);};
  for(let x=cx*16;x<cx*16+16;x++)for(let z=cz*16;z<cz*16+16;z++) {
    if(!insideHorizontal(x,z))continue;
    const col=world.surfaceColumn(x,z),edits=water.byColumn.get(`${x},${z}`);
    let minY=col.waterY==null?Infinity:col.height+1,maxY=col.waterY??-Infinity;
    if(edits)for(const [y,v]of edits)if(v>0){minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    for(let y=Math.max(MIN_WORLD_Y,cy*16,minY);y<=Math.min(MAX_WORLD_Y,cy*16+15,maxY);y++) {
      if(!water.get(x,y,z))continue;
      const above=water.get(x,y+1,z);
      if(!above&&!world.hasBlock(x,y+1,z)) {
        const offsets=[[0,1],[1,1],[1,0],[0,0]],props=offsets.map(([ox,oz])=>corner(x+ox,y,z+oz));
        waterQuad(g,offsets.map(([ox,oz],i)=>[x+ox,y+props[i].height,z+oz]),[0,1,0],props.map(p=>p.depth),props.map(p=>p.shore),1);
      }
      for(const s of SIDES) {
        if(world.hasBlock(x+s.dx,y,z+s.dz)||water.get(x+s.dx,y,z+s.dz))continue;
        const props=s.v.map(([ox,oy,oz])=>corner(x+ox,y,z+oz));
        waterQuad(g,s.v.map(([ox,oy,oz],i)=>[x+ox,y+(oy?(above?1:props[i].height):0),z+oz]),[s.dx,0,s.dz],props.map(p=>p.depth),props.map(p=>p.shore),0,above?[0,0,0,0]:[0,0,1,1]);
      }
    }
  }
  return g;
}

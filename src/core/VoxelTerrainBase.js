import * as THREE from 'three/webgpu';
import { sampleSkylight } from './Skylight.js';
import { planTerrain, FAR_TILE_SIZE } from './StreamPlanner.js';
import {
  WORLD_HALF, CHUNK_SIZE, SECTION_HEIGHT, MIN_WORLD_Y, MAX_WORLD_Y, SEED,
  MIN_CHUNK, MAX_CHUNK, MIN_SECTION, MAX_SECTION, BLOCK, insideHorizontal,
  terrainHeight, naturalBlock, grassTintAt, textureOrientation, orientedFaceUV, blockKey, columnKey, sectionKey
} from './Terrain.js';

// Никаких объектов на каждый куб. Только не закрытые соседями грани в секциях 16³.
const FACES = [
  { d: [0, 1, 0], kind: 0, axis: [0, 2], verts: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]] },
  { d: [0,-1, 0], kind: 2, axis: [0, 2], verts: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },
  { d: [1, 0, 0], kind: 1, axis: [1, 2], verts: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]] },
  { d: [-1,0, 0], kind: 1, axis: [1, 2], verts: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]] },
  { d: [0, 0, 1], kind: 1, axis: [0, 1], verts: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]] },
  { d: [0, 0,-1], kind: 1, axis: [0, 1], verts: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]] }
];
const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];

/**
 * Горизонтальные чанки + ВЕРТИКАЛЬНЫЕ секции 16³. Сохранения — разреженная
 * дельта {"x,y,z": id блока}; чистая порода вычисляется по seed без массива
 * на всю глубину. Не нужно выделять память под 500 или 5000 подземных метров.
 */
export class VoxelWorld {
  constructor(scene, materials, savedEdits = null, seed = SEED) {
    this.scene = scene;
    this.materials = materials;
    this.lodMaterial = materials[0].clone();
    this.lodMaterial.side = THREE.DoubleSide;
    this.lodMaterial.shadowSide = THREE.DoubleSide;
    this.lodMaterial.polygonOffset = true;
    this.lodMaterial.polygonOffsetFactor = 0.4;
    this.lodMaterial.polygonOffsetUnits = 1;
    this.seed = seed;
    this.edits = new Map();
    this.columnEdits = new Map();
    this.sections = new Map();
    this.chunks = this.sections; // обратная совместимость с диагностикой v0.1.1
    this.heights = new Map();
    this.tops = new Map();
    this.skylightCache = new Map();
    this.viewDistance = 200;
    this.lodTiles = new Map();
    this.streamQueue = [];
    this.streamOrigin = null;
    this.nearRadius = 92;
    this.lastRequestedSections = new Set();
    this.lastRequestedTiles = new Set();
    if (savedEdits && typeof savedEdits === 'object') {
      for (const [key, value] of Object.entries(savedEdits).slice(0, 300000)) {
        const parts = key.split(',').map(Number);
        if (parts.length !== 3 || !parts.every(Number.isInteger)) continue;
        const [x, y, z] = parts;
        // Старые сохранения v0.1.1: 0 = пустота, 1 = травяной блок.
        if (insideHorizontal(x, z) && y >= MIN_WORLD_Y && y <= MAX_WORLD_Y &&
            Number.isInteger(value) && value >= 0 && value <= BLOCK.DEEP_STONE) {
          this.storeEdit(x, y, z, value);
        }
      }
    }
  }

  storeEdit(x, y, z, value) {
    const key = blockKey(x, y, z), col = columnKey(x, z);
    this.edits.set(key, value);
    let ys = this.columnEdits.get(col);
    if (!ys) { ys = new Map(); this.columnEdits.set(col, ys); }
    ys.set(y, value);
  }

  heightSeed(x, z) {
    const col = columnKey(x, z);
    if (!this.heights.has(col)) {
      // Кеш ближайших колонок, а не всех 4 000 000 точек карты.
      if(this.heights.size>85000)this.heights.clear();
      this.heights.set(col, terrainHeight(x, z, this.seed));
    }
    return this.heights.get(col);
  }

  baseBlock(x, y, z) {
    return naturalBlock(x, y, z, this.seed, this.heightSeed(x, z));
  }


  getBlock(x, y, z) {
    if (!insideHorizontal(x, z) || y < MIN_WORLD_Y || y > MAX_WORLD_Y) return BLOCK.AIR;
    const changes = this.columnEdits.get(columnKey(x, z));
    if (changes?.has(y)) return changes.get(y);
    return this.baseBlock(x, y, z);
  }

  hasBlock(x, y, z) { return this.getBlock(x, y, z) !== BLOCK.AIR; }

  /** Поверхность вычисляется по seed за O(1); правки проверяются разреженно. */
  highestSolid(x, z) {
    if (!insideHorizontal(x, z)) return MIN_WORLD_Y - 1;
    const key=columnKey(x,z);
    if(this.tops.has(key))return this.tops.get(key);
    let top=this.heightSeed(x,z);
    const edits=this.columnEdits.get(key);
    if(edits){
      for(const [y,type] of edits)if(type!==BLOCK.AIR && y>top)top=y;
      while(top>=MIN_WORLD_Y && this.getBlock(x,top,z)===BLOCK.AIR)top--;
    }
    if(this.tops.size>75000)this.tops.clear();
    this.tops.set(key,top);
    return top;
  }

  heightAt(x, z) { return this.highestSolid(Math.floor(x), Math.floor(z)) + 1; }

  /** Кешируемая освещённость открытых воздушных каналов и тоннелей. */
  skyExposure(x,y,z) {
    return sampleSkylight(this,x,y,z,this.skylightCache);
  }

  /** Первый кадр: только ближайшие секции, остальное дозировано по кадрам. */
  buildInitial(position={x:0.5,y:10,z:0.5},distance=200) {
    this.replanStreaming(position,distance,true);
    this.processStreaming(25,5);
  }

  /** Планировщик не трогает геометрию, только формирует очередь работ. */
  replanStreaming(position,drawDistance=200,force=false) {
    const px=position.x,pz=position.z,py=position.y;
    const old=this.streamOrigin;
    if(!force && old && Math.hypot(px-old.x,pz-old.z)<CHUNK_SIZE*.7 &&
       Math.abs(py-old.y)<SECTION_HEIGHT*.5 && drawDistance===old.distance)return;
    this.viewDistance=drawDistance;
    this.streamOrigin={x:px,y:py,z:pz,distance:drawDistance};
    const plan=planTerrain(px,pz,drawDistance);
    this.nearRadius=plan.radius;
    const wanted=new Map();
    const playerSection=Math.floor(py/SECTION_HEIGHT);
    for(const {cx,cz,priority} of plan.near){
      // Детерминированные высоты у четырёх углов учитывают пересечения секций.
      const h=[
        this.heightSeed(Math.max(-WORLD_HALF,cx*CHUNK_SIZE),Math.max(-WORLD_HALF,cz*CHUNK_SIZE)),
        this.heightSeed(Math.min(WORLD_HALF-1,(cx+1)*CHUNK_SIZE-1),Math.max(-WORLD_HALF,cz*CHUNK_SIZE)),
        this.heightSeed(Math.max(-WORLD_HALF,cx*CHUNK_SIZE),Math.min(WORLD_HALF-1,(cz+1)*CHUNK_SIZE-1)),
        this.heightSeed(Math.min(WORLD_HALF-1,(cx+1)*CHUNK_SIZE-1),Math.min(WORLD_HALF-1,(cz+1)*CHUNK_SIZE-1))
      ];
      let minCy=Math.floor((Math.min(...h)-1)/SECTION_HEIGHT);
      let maxCy=Math.floor((Math.max(...h)+1)/SECTION_HEIGHT);
      const add=(cy,extra)=>{
        if(cy<MIN_SECTION || cy>MAX_SECTION)return;
        const id=sectionKey(cx,cy,cz);
        wanted.set(id,Math.min(wanted.get(id)??Infinity,priority+extra));
      };
      for(let cy=minCy;cy<=maxCy;cy++)add(cy,6);
      // Вблизи игрока открытые штольни загружаются вместе с поверхностью.
      if(priority<plan.radius*.77)for(let cy=playerSection-1;cy<=playerSection+1;cy++)add(cy,Math.abs(cy-playerSection)*5);
      // В местах изменённых блоков сохраняем визуализацию и при глубоком копании.
      for(const [id] of this.sections){
        const [ix,iy,iz]=id.split(',').map(Number);
        if(ix===cx&&iz===cz && Math.abs(iy-playerSection)<=2)add(iy,30);
      }
    }
    for(const [id,mesh] of this.sections)if(!wanted.has(id)){
      this.scene.remove(mesh);mesh.geometry.dispose();this.sections.delete(id);
    }
    const desiredFar=new Map();
    for(const tile of plan.far)desiredFar.set(`${tile.tx},${tile.tz}`,tile);
    for(const [id,record] of this.lodTiles)if(!desiredFar.has(id)){
      this.scene.remove(record.mesh);record.mesh.geometry.dispose();this.lodTiles.delete(id);
    }
    const jobs=[];
    for(const [id,priority] of wanted)if(!this.sections.has(id)){
      const [cx,cy,cz]=id.split(',').map(Number);
      jobs.push({kind:'voxel',cx,cy,cz,priority});
    }
    for(const [id,tile] of desiredFar){
      const oldTile=this.lodTiles.get(id);
      const nearTile=tile.priority < plan.radius+FAR_TILE_SIZE;
      const obsoleteMask=nearTile && oldTile && Math.hypot(px-oldTile.maskX,pz-oldTile.maskZ)>25;
      if(!oldTile || oldTile.step!==tile.step || obsoleteMask)
        jobs.push({kind:'far',...tile,priority:tile.priority+18});
    }
    jobs.sort((a,b)=>a.priority-b.priority);
    this.streamQueue=jobs;
    this.lastRequestedSections=new Set(wanted.keys());
    this.lastRequestedTiles=new Set(desiredFar.keys());
  }

  /** Ограничиваем перестройку геометрии в одном кадре, исключая фризы. */
  processStreaming(nearBudget=2,farBudget=1) {
    if(!this.streamQueue.length)return;
    const leftover=[];
    for(const job of this.streamQueue){
      if(job.kind==='voxel'&&nearBudget>0){
        nearBudget--;this.rebuildSection(job.cx,job.cy,job.cz);
      } else if(job.kind==='far'&&farBudget>0){
        farBudget--;this.buildFarTile(job.tx,job.tz,job.step);
      } else leftover.push(job);
    }
    this.streamQueue=leftover;
  }

  /** Heightfield LOD 128×128 м — только на расстоянии от полноценных вокселей.
   * Не является физическим миром: коллизия ВСЕГДА запрашивает getBlock().
   */
  buildFarTile(tx,tz,step) {
    const id=`${tx},${tz}`;
    const old=this.lodTiles.get(id);
    if(old){this.scene.remove(old.mesh);old.mesh.geometry.dispose();this.lodTiles.delete(id);}
    const startX=Math.max(-WORLD_HALF,tx*FAR_TILE_SIZE);
    const endX=Math.min(WORLD_HALF,(tx+1)*FAR_TILE_SIZE);
    const startZ=Math.max(-WORLD_HALF,tz*FAR_TILE_SIZE);
    const endZ=Math.min(WORLD_HALF,(tz+1)*FAR_TILE_SIZE);
    if(startX>=endX || startZ>=endZ)return;
    const xs=[],zs=[];
    for(let x=startX;x<endX;x+=step)xs.push(x);
    xs.push(endX);
    for(let z=startZ;z<endZ;z+=step)zs.push(z);
    zs.push(endZ);
    const pos=[],uv=[],colors=[],indices=[];
    const ny=zs.length;
    const addVertex=(x,z,drop=0)=>{
      const sx=Math.floor(Math.min(WORLD_HALF-1,Math.max(-WORLD_HALF,x)));
      const sz=Math.floor(Math.min(WORLD_HALF-1,Math.max(-WORLD_HALF,z)));
      const h=this.heightSeed(sx,sz)+0.82-drop;
      pos.push(x,h,z);uv.push(x,z);
      const tint=grassTintAt(x,z,this.seed);
      colors.push(tint.r,tint.g,tint.b);
      return pos.length/3-1;
    };
    for(let i=0;i<xs.length;i++)for(let j=0;j<ny;j++)addVertex(xs[i],zs[j],0);
    for(let i=0;i<xs.length-1;i++)for(let j=0;j<zs.length-1;j++){
      const mx=(xs[i]+xs[i+1])*.5,mz=(zs[j]+zs[j+1])*.5;
      const player=this.streamOrigin;
      const maskRadius=this.nearRadius + step * 1.2;
      if(player&&Math.hypot(mx-player.x,mz-player.z)<maskRadius)continue;
      const a=i*ny+j,b=(i+1)*ny+j,c=a+1,d=b+1;
      indices.push(a,c,b,b,c,d);
    }
    const skirtDrop=Math.max(22,step*2.2);
    const addSkirt=(a,b)=>{
      const a2=addVertex(pos[a*3],pos[a*3+2],skirtDrop);
      const b2=addVertex(pos[b*3],pos[b*3+2],skirtDrop);
      indices.push(a,b,b2,a,b2,a2);
    };
    for(let i=0;i<xs.length-1;i++) addSkirt(i*ny,(i+1)*ny);
    for(let i=0;i<xs.length-1;i++) addSkirt(i*ny+(ny-1),(i+1)*ny+(ny-1));
    for(let j=0;j<zs.length-1;j++) addSkirt(j,j+1);
    for(let j=0;j<zs.length-1;j++) addSkirt((xs.length-1)*ny+j,(xs.length-1)*ny+j+1);
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geo.setIndex(indices);
    geo.computeVertexNormals();geo.computeTangents();geo.computeBoundingSphere();
    const mesh=new THREE.Mesh(geo,this.lodMaterial);
    mesh.name=`far-lod(${tx},${tz},${step})`;
    mesh.castShadow=false;mesh.receiveShadow=true;
    mesh.frustumCulled=true;
    mesh.visible=indices.length>0;
    this.scene.add(mesh);
    this.lodTiles.set(id,{mesh,step,maskX:this.streamOrigin?.x??0,maskZ:this.streamOrigin?.z??0});
  }

  /** Можно передать ID блока, либо старые true/false для кода v0.1.1. */
  setBlock(x, y, z, id) {
    if (![x,y,z].every(Number.isInteger) || !insideHorizontal(x,z) || y < MIN_WORLD_Y || y > MAX_WORLD_Y) return false;
    const value = id === true ? BLOCK.GRASS : id === false ? BLOCK.AIR : id;
    if (!Number.isInteger(value) || value < BLOCK.AIR || value > BLOCK.DEEP_STONE) return false;
    if (this.getBlock(x,y,z) === value) return false;
    const key = blockKey(x,y,z), col = columnKey(x,z);
    if (this.baseBlock(x,y,z) === value) {
      this.edits.delete(key);
      const ys = this.columnEdits.get(col);
      ys?.delete(y);
      if (ys?.size === 0) this.columnEdits.delete(col);
    } else this.storeEdit(x,y,z,value);
    this.tops.delete(col);
    this.skylightCache.clear();

    // AO и освещение пещер зависят от соседних секций, но не от удалённых.
    const cx = Math.floor(x/CHUNK_SIZE), cy = Math.floor(y/SECTION_HEIGHT), cz = Math.floor(z/CHUNK_SIZE);
    const mx = ((x%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE;
    const my = ((y%SECTION_HEIGHT)+SECTION_HEIGHT)%SECTION_HEIGHT;
    const mz = ((z%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE;
    const axis=(offset,size)=>[0,...(offset<=1?[-1]:[]),...(offset>=size-2?[1]:[])];
    for(const ox of axis(mx,CHUNK_SIZE))
      for(const oy of axis(my,SECTION_HEIGHT))
        for(const oz of axis(mz,CHUNK_SIZE)){
          const tx=cx+ox,ty=cy+oy,tz=cz+oz;
          if((ox===0&&oy===0&&oz===0)||this.sections.has(sectionKey(tx,ty,tz)))
            this.rebuildSection(tx,ty,tz);
        }
    return true;
  }

  /** Вершинное AO + недорогая «солнечная видимость» в воздушной клетке. */
  vertexLight(x, y, z, face, vertex, sky) {
    const [a,b] = face.axis;
    const sa = vertex[a] ? 1 : -1, sb = vertex[b] ? 1 : -1;
    const p = [x+face.d[0],y+face.d[1],z+face.d[2]];
    const q1 = p.slice(), q2 = p.slice(), diag = p.slice();
    q1[a] += sa; q2[b] += sb; diag[a] += sa; diag[b] += sb;
    const s1 = Number(this.hasBlock(...q1)), s2 = Number(this.hasBlock(...q2));
    const s3 = Number(this.hasBlock(...diag));
    const corner = s1 && s2 ? 0.49 : 1 - (s1+s2+s3)*0.12;
    const faceFactor = face.kind === 0 ? 1 : face.kind === 2 ? 0.77 : 0.90;
    return Math.max(0.025, corner * faceFactor * (0.07 + 0.93 * sky));
  }

  /** Материалы: 0 трава сверху, 1 бок травы, 2 земля, 3 каменистая земля, 4 плотная земля, 5 сланец, 6 глубинная порода. */
  materialGroup(type, face) {
    if (type === BLOCK.GRASS) return face.kind === 0 ? 0 : face.kind === 1 ? 1 : 2;
    if (type === BLOCK.DIRT) return 2;
    if (type === BLOCK.ROCKY_DIRT) return 3;
    if (type === BLOCK.COMPACT_EARTH) return 4;
    if (type === BLOCK.SHALE) return 5;
    return 6;
  }


  rebuildSection(cx,cy,cz) {
    if (cx < MIN_CHUNK || cx > MAX_CHUNK || cz < MIN_CHUNK || cz > MAX_CHUNK ||
        cy < MIN_SECTION || cy > MAX_SECTION) return;
    const id = sectionKey(cx,cy,cz);
    const old = this.sections.get(id);
    if (old) { this.scene.remove(old); old.geometry.dispose(); this.sections.delete(id); }
    const groups = Array.from({length:7},()=>({positions:[],normals:[],uv:[],colors:[],indices:[]}));
    for (let x=cx*CHUNK_SIZE; x<(cx+1)*CHUNK_SIZE; x++) {
      for (let z=cz*CHUNK_SIZE; z<(cz+1)*CHUNK_SIZE; z++) {
        if (!insideHorizontal(x,z)) continue;
        const top = Math.min(MAX_WORLD_Y, Math.max(this.heightSeed(x,z), this.highestSolid(x,z)));
        const bottom = Math.max(MIN_WORLD_Y, cy*SECTION_HEIGHT);
        const upper = Math.min(top, (cy+1)*SECTION_HEIGHT-1);
        for (let y=bottom; y<=upper; y++) {
          const type = this.getBlock(x,y,z);
          if (type===BLOCK.AIR) continue;
          for (const face of FACES) {
            const [dx,dy,dz] = face.d;
            if (this.hasBlock(x+dx,y+dy,z+dz)) continue;
            const group = groups[this.materialGroup(type,face)];
            const start=group.positions.length/3;
            const sky=this.skyExposure(x+dx,y+dy,z+dz);
            for (let i=0;i<4;i++) {
              const v=face.verts[i];
              group.positions.push(x+v[0],y+v[1],z+v[2]);
              group.normals.push(dx,dy,dz);
              const groupId=this.materialGroup(type,face);
              const [u,w]=orientedFaceUV(UV[i][0],UV[i][1],textureOrientation(x,y,z,this.seed),type,face.kind);
              group.uv.push(u,w);
              const b=this.vertexLight(x,y,z,face,v,sky);
              if(groupId===0 || groupId===1){
                const t=grassTintAt(x+v[0],z+v[2],this.seed);
                group.colors.push(b*t.r,b*t.g,b*t.b);
              } else group.colors.push(b,b,b);
            }
            group.indices.push(start,start+1,start+2,start,start+2,start+3);
          }
        }
      }
    }
    const pos=[],nrm=[],uv=[],col=[],idx=[];
    const geo=new THREE.BufferGeometry();
    for (let n=0;n<groups.length;n++) {
      const g=groups[n], offset=pos.length/3, from=idx.length;
      // Без spread(...) — большой 16³ чанк с полостями не превышает стек JS.
      for(const v of g.positions)pos.push(v);
      for(const v of g.normals)nrm.push(v);
      for(const v of g.uv)uv.push(v);
      for(const v of g.colors)col.push(v);
      for (const j of g.indices) idx.push(j+offset);
      if (g.indices.length) geo.addGroup(from,g.indices.length,n);
    }
    if (!idx.length) { geo.dispose();return; }
    geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    geo.setAttribute('normal',new THREE.Float32BufferAttribute(nrm,3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
    geo.setIndex(idx);
    geo.computeTangents();
    geo.computeBoundingSphere();
    const mesh=new THREE.Mesh(geo,this.materials);
    mesh.name=`section(${cx},${cy},${cz})`;
    mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=true;
    this.scene.add(mesh);this.sections.set(id,mesh);
  }

  /** Совместимость: видимость управляется дистанционным стримингом/LOD. */
  updateVisibility(position,drawDistance=this.viewDistance) {
    this.replanStreaming(position,drawDistance);
  }

  getStreamStats(){return {sections:this.sections.size,farTiles:this.lodTiles.size,pending:this.streamQueue.length};}

  raycast(origin,direction,maxDistance=6) {
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
      if(nextX<=nextY && nextX<=nextZ) {x+=sx;dist=nextX;nextX+=tx;nx=-sx;ny=0;nz=0;}
      else if(nextY<=nextZ) {y+=sy;dist=nextY;nextY+=ty;nx=0;ny=-sy;nz=0;}
      else {z+=sz;dist=nextZ;nextZ+=tz;nx=0;ny=0;nz=-sz;}
    }
    return null;
  }

  toJSON(){return Object.fromEntries(this.edits);}
}

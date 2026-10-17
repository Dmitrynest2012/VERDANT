import * as THREE from 'three/webgpu';
import { uniform, attribute, positionLocal, positionWorld, normalView, cameraPosition,
  cameraViewMatrix, vec2, vec3, vec4, sin, cos, color, mix, smoothstep, screenUV,
  viewportSharedTexture, viewportSafeUV, faceDirection } from 'three/tsl';
import { emptyWaterGeometry, waterQuad, buildWaterSection } from '../core/WaterGeometry.js';
import { LAKE_CELL_SIZE } from '../core/SurfaceHydrology.js';

/** Общий WebGPU/TSL материал всех водоёмов, а не отдельный отражатель на каждый куб. */
export class WaterRenderer {
  constructor(scene,world,camera) {
    this.scene=scene;this.world=world;this.camera=camera;this.time=uniform(0);
    this.under=uniform(0);this.waterFog=new THREE.Color('#15596c');this.meshes=new Map();this.empty=new Set();this.jobs=[];
    this.elapsed=0;this.lastPlan='';this.nearColumns=new Set();this.refract=true;
    const info=attribute('waterInfo','vec3'),top=info.z,waveMask=attribute('waveMask','float');
    const phase=positionWorld.x.mul(.73).add(positionWorld.z.mul(.47)).add(this.time.mul(1.1));
    const phase2=positionWorld.x.mul(-1.21).add(positionWorld.z.mul(.82)).sub(this.time.mul(.76));
    const nx=cos(phase).mul(-.073).add(cos(phase2).mul(.035));
    const nz=cos(phase).mul(-.047).add(cos(phase2).mul(-.029));
    const wave=vec3(nx,1,nz).normalize();
    const normal=cameraViewMatrix.mul(vec4(wave,0)).xyz;
    const eye=cameraPosition.sub(positionWorld).normalize();
    const fresnel=wave.dot(eye).abs().oneMinus().pow(4).mul(.85).add(.025);
    const depth=smoothstep(.2,8,info.x);
    const foam=info.y.mul(sin(phase.mul(2.2)).mul(.5).add(.5)).mul(.14).mul(top);
    const material=new THREE.MeshPhysicalNodeMaterial({roughness:.18,metalness:0,ior:1.333,
      clearcoat:.3,clearcoatRoughness:.14,transparent:true,depthWrite:false,side:THREE.DoubleSide});
    // Единая фаза в мировых координатах: между секциями нет разрывов волн.
    const p1=positionLocal.x.mul(.73).add(positionLocal.z.mul(.47)).add(this.time.mul(1.1));
    const p2=positionLocal.x.mul(-1.21).add(positionLocal.z.mul(.82)).sub(this.time.mul(.76));
    const displacement=sin(p1).mul(.025).add(sin(p2).mul(.012)).mul(waveMask).mul(info.y.mul(.75).oneMinus());
    material.positionNode=positionLocal.add(vec3(0,displacement,0));
    material.normalNode=mix(normalView,normal.mul(faceDirection),top).normalize();
    material.colorNode=mix(color('#479aac'),color('#124058'),depth).add(vec3(foam));
    // Небо отражается приближённо; отражения объектов за камерой не имитируем.
    material.emissiveNode=color('#a8d7f0').mul(fresnel.mul(.55)).add(vec3(foam.mul(.5))).mul(this.under.mul(.6).oneMinus());
    const bend=vec2(nx,nz).mul(.013).mul(depth.mul(.5).add(.5));
    this.background=viewportSharedTexture(viewportSafeUV(screenUV.add(bend))).rgb;
    this.refractionNode=this.background.mul(mix(vec3(.94,1,1),vec3(.42,.72,.84),depth));
    material.backdropNode=this.refractionNode;
    material.backdropAlphaNode=fresnel.oneMinus().mul(foam.oneMinus()).mul(.86);
    material.opacity=1;material.name='verdant-water-refraction';
    this.material=material;
  }
  setQuality(mode) {
    const refract=mode!=='low';
    if(this.refract!==refract) {
      this.refract=refract;
      this.material.backdropNode=refract?this.refractionNode:null;
      this.material.opacity=refract?1:.68;
      this.material.needsUpdate=true;
    }
  }
  remove(key) {const m=this.meshes.get(key);if(m){this.scene.remove(m);m.geometry.dispose();this.meshes.delete(key);}this.empty.delete(key);}
  install(key,data) {
    this.remove(key);
    if(!data.index.length){this.empty.add(key);return;}
    const geometry=new THREE.BufferGeometry();
    for(const [name,size] of [['position',3],['normal',3],['uv',2],['waterInfo',3],['waveMask',1]])
      geometry.setAttribute(name,new THREE.Float32BufferAttribute(data[name],size));
    geometry.setIndex(data.index);geometry.computeBoundingSphere();
    geometry.boundingSphere.radius+=.1;
    const mesh=new THREE.Mesh(geometry,this.material);
    mesh.name=`water:${key}`;mesh.castShadow=false;mesh.receiveShadow=true;mesh.renderOrder=2;
    this.scene.add(mesh);this.meshes.set(key,mesh);
  }
  plan(player,distance) {
    const key=`${Math.floor(player.x/16)},${Math.floor(player.y/16)},${Math.floor(player.z/16)},${distance}`;
    if(key===this.lastPlan)return;
    this.lastPlan=key;
    const wanted=new Map();this.nearColumns.clear();
    // Добавляем верхнюю секцию озера, даже если она состоит только из воды/воздуха.
    for(const id of this.world.lastRequestedSections) {
      const [cx,cy,cz]=id.split(',').map(Number);this.nearColumns.add(`${cx},${cz}`);
      wanted.set(`n:${id}`,{kind:'near',id,cx,cy,cz,priority:Math.hypot(cx*16+8-player.x,cz*16+8-player.z)});
      const surface=this.world.surfaceColumn(cx*16+8,cz*16+8);
      if(surface.waterY!==null) {
        const sy=Math.floor(surface.waterY/16),sid=`${cx},${sy},${cz}`;
        wanted.set(`n:${sid}`,{kind:'near',id:sid,cx,cy:sy,cz,priority:20});
      }
    }
    const h=this.world.hydrology;
    if(h.version>=2) {
      const lakes=[h.home];const r=Math.ceil(distance/LAKE_CELL_SIZE)+1;
      const a=Math.floor(player.x/LAKE_CELL_SIZE),b=Math.floor(player.z/LAKE_CELL_SIZE);
      for(let x=a-r;x<=a+r;x++)for(let z=b-r;z<=b+r;z++)lakes.push(h.lake(x,z));
      for(const lake of lakes)if(lake) {
        const d=Math.hypot(lake.x-player.x,lake.z-player.z);
        if(d<distance+lake.rx)wanted.set(`f:${lake.id}`,{kind:'far',lake,priority:d});
      }
    }
    for(const id of [...this.meshes.keys(),...this.empty])if(!wanted.has(id))this.remove(id);
    // Дальние поверхности исключают области полноценных водяных секций.
    for(const [id,job] of wanted) if(job.kind==='far')this.remove(id);
    this.jobs=[...wanted.entries()].filter(([id])=>!this.meshes.has(id)&&!this.empty.has(id)).map(([id,j])=>({...j,key:id})).sort((a,b)=>a.priority-b.priority);
    this.wanted=wanted;
  }
  farGeometry(lake) {
    const g=emptyWaterGeometry(),water=this.world.water;
    const d=Math.hypot(lake.x-this.camera.position.x,lake.z-this.camera.position.z),step=d<260?1:2;
    const x0=Math.floor((lake.x-lake.rx*1.1)/step)*step,x1=lake.x+lake.rx*1.1;
    const z0=Math.floor((lake.z-lake.rz*1.1)/step)*step,z1=lake.z+lake.rz*1.1;
    for(let x=x0;x<x1;x+=step)for(let z=z0;z<z1;z+=step) {
      if(this.nearColumns.has(`${Math.floor((x+.5)/16)},${Math.floor((z+.5)/16)}`))continue;
      const col=this.world.surfaceColumn(x,z);
      if(col.waterY===null || !water.get(x,col.waterY,z))continue;
      const y=col.waterY+8/9;
      waterQuad(g,[[x,y,z+step],[x+step,y,z+step],[x+step,y,z],[x,y,z]],[0,1,0],col.waterY-col.height,0,1);
    }
    return g;
  }
  update(dt,player,distance) {
    this.time.value+=dt;this.elapsed+=dt;
    if(this.elapsed>.45 || !this.lastPlan){this.elapsed=0;this.plan(player.position,distance);}
    let built=0;
    for(const id of this.world.water.dirty) {
      this.world.water.dirty.delete(id);const k=`n:${id}`;
      if(this.wanted?.has(k)) {
        const [cx,cy,cz]=id.split(',').map(Number);this.install(k,buildWaterSection(this.world,cx,cy,cz));
        if(++built>=2)break;
      }
    }
    if(built<2 && this.jobs.length) {
      const job=this.jobs.shift();
      this.install(job.key,job.kind==='near'?buildWaterSection(this.world,job.cx,job.cy,job.cz):this.farGeometry(job.lake));
    }
  }
  environment(env,dt,player) {
    const depth=this.world.water.pointDepth(this.camera.position.x,this.camera.position.y,this.camera.position.z);
    this.under.value+=(Number(depth>.035)-this.under.value)*(1-Math.exp(-dt*12));
    document.body.classList.toggle('underwater',this.under.value>.4);
    if(this.under.value>.01) {
      env.scene.fog.color.lerp(this.waterFog,this.under.value);
      env.scene.fog.near=THREE.MathUtils.lerp(env.scene.fog.near,.45,this.under.value);
      env.scene.fog.far=THREE.MathUtils.lerp(env.scene.fog.far,Math.max(8,24-depth*1.3),this.under.value);
    }
    player.waterDepth=depth;player.submerged=depth>.035;
  }
  dispose() {for(const key of this.meshes.keys())this.remove(key);this.material.dispose();}
}
